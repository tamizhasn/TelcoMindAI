# 🧠 TelcoMind AI - Proactive Telecom Voice Agent

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Llama 3.1](https://img.shields.io/badge/Meta_Llama_3.1-0467DF?style=for-the-badge)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![Deepgram](https://img.shields.io/badge/Deepgram-111111?style=for-the-badge)

**TelcoMind AI** is an enterprise-grade, sub-second latency voice AI agent built specifically for the telecommunications industry. 

Unlike traditional reactive chatbots that wait for users to explain their problems, TelcoMind acts as a **Proactive Virtual Employee**. It features long-term SQLite memory, predicts customer issues based on network history before they finish speaking, calculates real-time SLAs, and autonomously manages the entire call lifecycle.

Built with a true asynchronous WebSocket architecture, it supports raw audio streaming from both PSTN cellular providers (like Twilio) and direct browser-based WebRTC for zero-lag local demonstrations.

---

## ✨ Key Features

* **⚡ Zero-Lag Voice-to-Voice:** Utilizes `AsyncGroq` and Deepgram's Nova-2/Aura-Asteria models over WebSockets for human-like conversational speed (under 500ms response time).
* **🧠 Proactive Memory Pipeline:** Saves comprehensive call summaries to a local SQLite database. Upon returning calls, the AI dynamically generates contextual greetings based on past unresolved issues.
* **🔮 Predictive SLA Engine:** Cross-references live transcripts with internal RAG policies to predict the customer's core issue and instantly quote resolution ETAs (e.g., "24-48 hours for fiber repair").
* **🛑 Autonomous Call Management:** The LLM actively monitors the conversation state and triggers an `"action": "terminate"` flag to autonomously hang up the call upon successful resolution or a manager escalation request.
* **📊 Live Telemetry Dashboard:** A stunning React glassmorphism UI that visualizes live audio waves, real-time sentiment analysis, intent tracking, and CRM technical notes.

---

## 🏗️ System Architecture

1. **The Ears (STT):** Audio is streamed via WebSockets to **Deepgram Nova-2** for real-time transcription.
2. **The Brain (LLM & Memory):** Transcripts are fed into **Llama-3.1-8b-instant** (via Groq) alongside the customer's SQLite memory log. The entire process runs on a true asynchronous Python event loop to prevent audio buffering.
3. **The Voice (TTS):** The generated JSON response is parsed, and the text is streamed to **Deepgram Aura-Asteria** for high-fidelity audio synthesis, piping back to the user instantly.
4. **The Supervisor (UI):** A React dashboard listens to the WebSocket telemetry to update sentiment, ETAs, and CRM logs in real-time.

---

## 🛠️ Tech Stack

* **Frontend:** React, Vite, Tailwind CSS, Lucide Icons, MediaRecorder API.
* **Backend:** Python, FastAPI, Uvicorn, WebSockets, Asyncio.
* **AI/ML:** Meta Llama 3.1 8B (via Groq), Deepgram (STT/TTS).
* **Database:** SQLite (for dynamic CRM call logs and memory).

---

## 🚀 Installation & Local Setup (WebRTC Demo Mode)

For hackathon presentations and local testing, TelcoMind features a WebRTC fallback that bypasses cellular networks for a flawless, zero-latency demonstration.

### Prerequisites
* Node.js (v18+)
* Python (3.10+)
* API Keys for [Groq](https://console.groq.com/) and [Deepgram](https://console.deepgram.com/)

### 1. Backend Setup
Navigate to the backend directory and set up your virtual environment:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. env file setup
```bash
GROQ_API_KEY=your_groq_key_here
DEEPGRAM_API_KEY=your_deepgram_key_here
TWILIO_ACCOUNT_SID=your_twilio_key_here
TWILIO_AUTH_TOKEN=your_twilio_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
# Ngrok Domain (No https://)
NGROK_URL=your.ngrok-free.app
```
### 3. Terminal 1 (frontend run)
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

### 4. Terminal 2 (backend run)
```bash
cd backend
uvicorn main:app --reload
# Runs on http://localhost:8000
```

### 5. Terminal 3 (Ngork run)
```bash
Ngrok installed on your machine.
Run Ngrok.exe on your machine.
run command : ngrok http 8000
```

### 6. Triggering a Live Phone Call
```bash
1. Open the React Dashboard (http://localhost:5173).

2. Enter your real cell phone number with the country code (e.g., 91(9876543210)) in the Customer Identifier box.

3. Click the purple "Call Phone" button.

4. Your phone will ring! Answer it, and the AI will speak directly to you over the cellular network while the React dashboard updates in real-time.
```



