import os, json, asyncio, httpx, sqlite3, base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import AsyncGroq 
from services.rag_service import retrieve_policy
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse, Connect

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

groq_client = AsyncGroq()
deepgram_client = DeepgramClient(os.getenv("DEEPGRAM_API_KEY"))
speech_lock = asyncio.Lock()

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER")
NGROK_DOMAIN = os.getenv("NGROK_URL") 

if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

# ✅ NEW: Global memory to track connected dashboards
active_dashboards = {}

async def broadcast_to_dashboard(customer_id: str, data: dict):
    """Pushes live Twilio call data to the React UI."""
    if customer_id in active_dashboards:
        try:
            await active_dashboards[customer_id].send_json(data)
        except Exception as e:
            print(f"Dashboard Broadcast Error: {e}")

# --- DATABASE LAYER ---
async def get_customer_context(customer_id: str):
    def query():
        conn = sqlite3.connect('telecom_memory.db')
        cursor = conn.cursor()
        cursor.execute('''CREATE TABLE IF NOT EXISTS call_history 
                          (customer_id TEXT, last_transcript TEXT, summary TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
        cursor.execute("SELECT summary FROM call_history WHERE customer_id=? ORDER BY timestamp DESC LIMIT 1", (customer_id,))
        result = cursor.fetchone()
        conn.close()
        return result[0] if result else "New Customer"
    return await asyncio.to_thread(query)

async def save_call_log(customer_id, transcript, summary):
    def save():
        conn = sqlite3.connect('telecom_memory.db')
        cursor = conn.cursor()
        cursor.execute("INSERT INTO call_history (customer_id, last_transcript, summary) VALUES (?, ?, ?)", 
                       (customer_id, transcript, summary))
        conn.commit()
        conn.close()
    await asyncio.to_thread(save)

# --- TTS LAYER ---
async def speak_response(text: str, websocket: WebSocket, is_twilio: bool = False, stream_sid: str = None):
    if is_twilio:
        url = "https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000"
    else:
        url = "https://api.deepgram.com/v1/speak?model=aura-asteria-en"
        
    headers = {"Authorization": f"Token {os.getenv('DEEPGRAM_API_KEY')}", "Content-Type": "application/json"}
    
    async with speech_lock:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, headers=headers, json={"text": text}, timeout=10)
                if response.status_code == 200:
                    if is_twilio and stream_sid:
                        audio_b64 = base64.b64encode(response.content).decode("utf-8")
                        await websocket.send_json({"event": "media", "streamSid": stream_sid, "media": {"payload": audio_b64}})
                    else:
                        await websocket.send_bytes(response.content)
            except Exception as e:
                print(f"❌ Audio Error: {e}")

# --- BRAIN LAYER ---
async def fetch_intelligence(sentence, past_history):
    relevant_policy = await asyncio.to_thread(retrieve_policy, sentence)
    prompt = f"""
    System: Proactive Telecom Agent. Past History: {past_history}. Policy: {relevant_policy}.
    Customer: "{sentence}"
    Task: Respond in JSON (keys: sentiment, intent, predicted_issue, eta, customer_facing_response, internal_note).
    """
    
    completion = await groq_client.chat.completions.create(
        model="llama-3.1-8b-instant", messages=[{"role": "user", "content": prompt}], response_format={"type": "json_object"}
    )
    try: ai_data = json.loads(completion.choices[0].message.content)
    except: ai_data = {}

    ai_data["type"] = "intelligence"
    ai_data["customer_facing_response"] = str(ai_data.get("customer_facing_response", "Let me check that."))
    return ai_data

@app.websocket("/ws/dashboard/{customer_id}")
async def dashboard_endpoint(websocket: WebSocket, customer_id: str):
    """Allows React to 'watch' a Twilio phone call silently."""
    await websocket.accept()
    clean_id = "".join(filter(str.isdigit, customer_id))
    active_dashboards[clean_id] = websocket
    try:
        while True:
            await websocket.receive_text() # Keep connection open
    except Exception:
        pass
    finally:
        if clean_id in active_dashboards and active_dashboards[clean_id] == websocket:
            del active_dashboards[clean_id]

@app.websocket("/ws/copilot/{customer_id}")
async def copilot_endpoint(websocket: WebSocket, customer_id: str):
    await websocket.accept()
    clean_id = "".join(filter(str.isdigit, customer_id))
    past_history = await get_customer_context(clean_id)
    full_session_transcript = []
    
    greet = "Hello! Welcome to InFynd Support. How can I help you today?"
    if past_history != "New Customer":
        res = await groq_client.chat.completions.create(model="llama-3.1-8b-instant", messages=[{"role":"user","content":f"Returning customer. Past issue: {past_history}. 1-sentence welcome back. Ask if they want an update. ONLY output greeting."}])
        greet = res.choices[0].message.content.strip(' "').split('\n')[0].strip()

    await websocket.send_json({"type": "intelligence", "customer_facing_response": greet, "intent": "Contextual Greeting", "predicted_issue": "Initial Inquiry", "eta": "Instant", "internal_note": f"Overview: Returning customer (Previous: {past_history[:30]}...)"})
    await speak_response(greet, websocket)

    dg_connection = deepgram_client.listen.asyncwebsocket.v("1")

    async def on_message(self, result, **kwargs):
        sentence = result.channel.alternatives[0].transcript
        if len(sentence) > 0 and result.is_final:
            await websocket.send_json({"type": "transcript", "text": sentence})
            full_session_transcript.append(f"Customer: {sentence}")
            
            async def run_logic():
                ai_data = await fetch_intelligence(sentence, past_history)
                await websocket.send_json(ai_data)
                await speak_response(ai_data["customer_facing_response"], websocket)
                full_session_transcript.append(f"AI: {ai_data['customer_facing_response']}")
            asyncio.create_task(run_logic())

    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
    await dg_connection.start(LiveOptions(model="nova-2", language="en-US", smart_format=True, endpointing=1500))

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect": break
            if "bytes" in message: await dg_connection.send(message["bytes"])
    except Exception: pass
    finally:
        try: await dg_connection.finish()
        except: pass
        if len(full_session_transcript) > 1:
            summ_res = await groq_client.chat.completions.create(model="llama-3.1-8b-instant", messages=[{"role": "user", "content": f"Summarize for CRM in one sentence: {' '.join(full_session_transcript)}" }])
            await save_call_log(clean_id, " ".join(full_session_transcript), summ_res.choices[0].message.content)


@app.post("/call-customer/{customer_number}")
async def call_customer(customer_number: str):
    try:
        call = twilio_client.calls.create(to=f"+{customer_number}", from_=TWILIO_PHONE_NUMBER, url=f"https://{NGROK_DOMAIN}/twiml/{customer_number}")
        return {"status": "Calling", "call_sid": call.sid}
    except Exception as e:
        return {"error": str(e)}

@app.post("/twiml/{customer_number}")
async def twilio_twiml(customer_number: str):
    response = VoiceResponse()
    connect = Connect()
    connect.stream(url=f"wss://{NGROK_DOMAIN}/ws/twilio/{customer_number}")
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")

@app.websocket("/ws/twilio/{customer_id}")
async def twilio_endpoint(websocket: WebSocket, customer_id: str):
    await websocket.accept()
    stream_sid = None
    clean_id = "".join(filter(str.isdigit, customer_id))
    past_history = await get_customer_context(clean_id)
    full_session_transcript = []

    greet = "Hello! This is InFynd Support calling. How can I assist you today?"
    if past_history != "New Customer":
        res = await groq_client.chat.completions.create(model="llama-3.1-8b-instant", messages=[{"role":"user","content":f"Returning customer. Past issue: {past_history}. 1-sentence outbound phone welcome. ONLY output greeting."}])
        greet = res.choices[0].message.content.strip(' "').split('\n')[0].strip()

    
    greet_data = {"type": "intelligence", "customer_facing_response": greet, "intent": "Contextual Greeting", "predicted_issue": "Initial Inquiry", "eta": "Instant", "internal_note": f"Overview: Active Phone Call..."}
    await broadcast_to_dashboard(clean_id, greet_data)

    dg_connection = deepgram_client.listen.asyncwebsocket.v("1")

    async def on_message(self, result, **kwargs):
        sentence = result.channel.alternatives[0].transcript
        if len(sentence) > 0 and result.is_final:
            full_session_transcript.append(f"Customer: {sentence}")
            
            
            await broadcast_to_dashboard(clean_id, {"type": "transcript", "text": sentence})
            
            async def run_phone_logic():
                ai_data = await fetch_intelligence(sentence, past_history)
                response_text = ai_data["customer_facing_response"]
                full_session_transcript.append(f"AI: {response_text}")
                
                await broadcast_to_dashboard(clean_id, ai_data)
                await speak_response(response_text, websocket, is_twilio=True, stream_sid=stream_sid)
            asyncio.create_task(run_phone_logic())

    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
    await dg_connection.start(LiveOptions(model="nova-2-phonecall", language="en-US", encoding="mulaw", sample_rate=8000, endpointing=1500))

    try:
        while True:
            message = await websocket.receive_json()
            if message["event"] == "start":
                stream_sid = message["start"]["streamSid"]
                await speak_response(greet, websocket, is_twilio=True, stream_sid=stream_sid)
            elif message["event"] == "media":
                audio_bytes = base64.b64decode(message["media"]["payload"])
                await dg_connection.send(audio_bytes)
            elif message["event"] == "stop":
                break
    except Exception: pass
    finally:
        print(f" Phone Call Ended for {clean_id}")
        try: await dg_connection.finish()
        except: pass
        if len(full_session_transcript) > 1:
            summ_res = await groq_client.chat.completions.create(model="llama-3.1-8b-instant", messages=[{"role": "user", "content": f"Summarize for CRM: {' '.join(full_session_transcript)}" }])
            await save_call_log(clean_id, " ".join(full_session_transcript), summ_res.choices[0].message.content)