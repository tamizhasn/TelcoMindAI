import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOutgoing, Activity, ShieldAlert, User, Cpu, Mic, MicOff, Clock, Zap } from 'lucide-react';

function App() {
  const [phoneNumber, setPhoneNumber] = useState('');
  // callState can be 'waiting', 'web', or 'phone'
  const [callState, setCallState] = useState('waiting'); 
  const [messages, setMessages] = useState([]);
  
  const [aiState, setAiState] = useState({ 
      isSpeaking: false, 
      sentiment: 'Neutral', 
      intent: 'Standby', 
      predicted_issue: 'Waiting for context...',
      eta: '...',
      note: 'Awaiting context to generate strategy...' 
  });
  
  const ws = useRef(null);
  const mediaRecorder = useRef(null);
  const currentAudio = useRef(null);
  const chatEndRef = useRef(null);
  const terminateFlag = useRef(false);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const endCall = () => {
    if (mediaRecorder.current && mediaRecorder.current.stream) {
        mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
    }
    if (ws.current && ws.current.readyState === 1) {
        ws.current.close();
    }
    
    setCallState('ended');
    setAiState(prev => ({ ...prev, isSpeaking: false, intent: 'Call Terminated', predicted_issue: 'SESSION CLOSED', eta: '...' }));
    
    if (currentAudio.current) {
        currentAudio.current.pause();
        currentAudio.current.currentTime = 0;
    }
    terminateFlag.current = false;
  };

  const handleSocketMessage = (event) => {
    if (event.data instanceof Blob) {
        const audioUrl = URL.createObjectURL(event.data);
        if (currentAudio.current) { currentAudio.current.pause(); }
        currentAudio.current = new Audio(audioUrl);
        currentAudio.current.onplay = () => setAiState(prev => ({...prev, isSpeaking: true}));
        currentAudio.current.onended = () => {
            setAiState(prev => ({...prev, isSpeaking: false}));
            if (terminateFlag.current) endCall();
        };
        currentAudio.current.play();
        return;
    }

    try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'transcript') {
          setMessages(prev => [...prev, { sender: 'Customer', text: String(data.text) }]);
        } 
        else if (data.type === 'intelligence') {
          setAiState(prev => ({ 
              ...prev, 
              sentiment: String(data.sentiment || prev.sentiment), 
              intent: String(data.intent || prev.intent), 
              predicted_issue: String(data.predicted_issue || prev.predicted_issue),
              eta: String(data.eta || "Instant"),
              note: String(data.internal_note || prev.note) 
          }));
          
          if (data.customer_facing_response) {
              setMessages(prev => [...prev, { sender: 'AI Agent', text: String(data.customer_facing_response) }]);
              
              // Simulate AI talking duration for the phone UI (since there's no web audio blob)
              if (callState === 'phone') {
                  setAiState(p => ({...p, isSpeaking: true}));
                  const duration = (data.customer_facing_response.split(' ').length) * 350; // Estimate 350ms per word
                  setTimeout(() => setAiState(p => ({...p, isSpeaking: false})), duration);
              }
          }
          
          if (data.escalate_to_human === true || data.action === 'terminate') terminateFlag.current = true;
        }
    } catch (error) {
        console.error("Ignored malformed socket data", error);
    }
  };

  // --- 1. START WEB CALL ---
  const toggleCall = async () => {
    if (callState === 'web') {
      endCall();
    } else {
      if (!phoneNumber.trim()) return alert("Enter Customer Number First");
      const cleanNumber = phoneNumber.replace(/\D/g, ''); 
      
      ws.current = new WebSocket(`ws://localhost:8000/ws/copilot/${cleanNumber}`);
      ws.current.onmessage = handleSocketMessage;
      
      setCallState('web');
      setMessages([]);
      terminateFlag.current = false;
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder.current = new MediaRecorder(stream);
        mediaRecorder.current.ondataavailable = (e) => {
            if (e.data.size > 0 && ws.current.readyState === 1) ws.current.send(e.data);
        };
        mediaRecorder.current.start(250); 
      } catch (err) { alert("Mic denied"); setCallState('waiting'); }
    }
  };

  // --- 2. START TWILIO PHONE CALL ---
  const triggerPhoneCall = async () => {
    if (callState === 'phone') {
        endCall(); // Allows you to close the dashboard connection
        return;
    }

    if (!phoneNumber.trim()) return alert("Enter Customer Number First");
    const cleanNumber = phoneNumber.replace(/\D/g, ''); 
    
    // Connect Dashboard Observer Socket
    setCallState('phone');
    setMessages([]);
    ws.current = new WebSocket(`ws://localhost:8000/ws/dashboard/${cleanNumber}`);
    ws.current.onmessage = handleSocketMessage;
    
    try {
        const response = await fetch(`http://localhost:8000/call-customer/${cleanNumber}`, { method: 'POST' });
        const data = await response.json();
        
        if (data.status === "Calling") {
            setAiState(prev => ({ ...prev, intent: 'Dialing Network...', note: `Ringing cellular network for +${cleanNumber}` }));
        } else {
            alert(`Call Failed: ${data.error}`);
            endCall();
        }
    } catch (error) {
        alert("Failed to reach backend.");
        endCall();
    }
  };

  const VoiceWaves = ({ active, color }) => (
    <div className="flex items-center gap-1 h-8">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`w-1 rounded-full ${color} transition-all duration-150 ${active ? 'animate-pulse' : 'h-1 opacity-30'}`}
          style={{ height: active ? `${Math.random() * 24 + 8}px` : '4px', animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );

  return (
    <div className="flex h-screen bg-[#050505] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(30,58,138,0.2),rgba(255,255,255,0))] text-slate-200 p-6 font-sans gap-6 overflow-hidden">
      
      {/* CHAT INTERFACE */}
      <div className="flex-[2] flex flex-col gap-6">
        <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex justify-between items-center shadow-2xl backdrop-blur-xl">
          <div className="flex gap-8 items-center">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Customer Identifier</p>
              <div className="flex items-center gap-2">
                <User size={16} className="text-blue-400" />
                <input 
                  type="text" 
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+91 00000 00000"
                  className="bg-transparent border-b border-white/20 text-xl font-mono font-bold text-white focus:outline-none focus:border-blue-500 transition-colors w-48"
                />
              </div>
            </div>
          </div>
          
          <div className="flex gap-4">
              <button 
                onClick={triggerPhoneCall} 
                disabled={callState === 'web'}
                className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-bold uppercase transition-all ${
                    callState === 'phone' ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                } ${callState === 'web' && 'opacity-50 cursor-not-allowed'}`}
              >
                <PhoneOutgoing size={20} />
                {callState === 'phone' ? 'Stop Tracking' : 'Call Phone'}
              </button>

              <button 
                onClick={toggleCall} 
                disabled={callState === 'phone'}
                className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-bold uppercase transition-all ${
                    callState === 'web' ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/50'
                } ${callState === 'phone' && 'opacity-50 cursor-not-allowed'}`}
              >
                {callState === 'web' ? <MicOff size={20} /> : <Mic size={20} />}
                {callState === 'web' ? 'End Web Call' : 'Web Voice Call'}
              </button>
          </div>
        </div>

        <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-6 overflow-y-auto space-y-6 relative backdrop-blur-md shadow-inner">
          {callState === 'waiting' && messages.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-4">
                  <div className="p-6 bg-white/5 rounded-full"><Phone size={48} className="opacity-40" /></div>
                  <span className="font-bold uppercase tracking-[0.2em] animate-pulse">Waiting for customer input...</span>
              </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.sender === 'Customer' ? 'items-start' : 'items-end'} animate-in fade-in slide-in-from-bottom-4 duration-300`}>
              <div className={`p-5 rounded-3xl max-w-[80%] shadow-lg ${
                msg.sender === 'Customer' 
                ? 'bg-slate-800/80 text-white border border-slate-700/50 rounded-tl-sm' 
                : 'bg-gradient-to-br from-blue-600 to-blue-800 text-white border border-blue-500/30 rounded-tr-sm'
              }`}>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-2">
                  {msg.sender === 'Customer' ? <User size={12}/> : <Cpu size={12}/>}
                  {msg.sender}
                </p>
                <p className="text-base leading-relaxed font-medium">{String(msg.text)}</p>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* INTELLIGENCE PANELS */}
      <div className="w-[450px] flex flex-col gap-6">
        <div className="bg-white/5 border border-white/10 p-8 rounded-3xl shadow-2xl flex flex-col items-center justify-center gap-8 backdrop-blur-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Live Audio Telemetry</p>
          <div className="w-full flex justify-between items-center px-6">
            <div className="flex flex-col items-center gap-3">
              <VoiceWaves active={(callState === 'web' || callState === 'phone') && !aiState.isSpeaking} color="bg-emerald-400" />
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Customer</p>
            </div>
            <Activity size={24} className="text-slate-700" />
            <div className="flex flex-col items-center gap-3">
              <VoiceWaves active={aiState.isSpeaking} color="bg-blue-400" />
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1"><Cpu size={12}/> AI AGENT</p>
            </div>
          </div>
        </div>

        {/* PREDICTION ENGINE */}
        <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 p-8 rounded-3xl shadow-[0_0_30px_rgba(79,70,229,0.15)] relative overflow-hidden backdrop-blur-xl">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 blur-[50px] rounded-full" />
            <div className="flex items-center gap-2 mb-6">
                <Zap size={20} className="text-amber-400" />
                <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300">Prediction Engine</p>
            </div>
            <div className="space-y-6 relative z-10">
                <div>
                    <p className="text-[10px] text-indigo-200/60 uppercase tracking-widest font-bold mb-2">Predicted Issue</p>
                    <p className="text-xl font-bold text-white leading-tight uppercase">{aiState.predicted_issue}</p>
                </div>
                <div className="flex items-center gap-4 bg-black/40 p-4 rounded-2xl border border-white/5 shadow-inner">
                    <div className="bg-emerald-500/20 p-2 rounded-lg"><Clock size={20} className="text-emerald-400" /></div>
                    <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Resolution ETA</p>
                        <p className="text-base font-bold text-emerald-300 tracking-wide uppercase">{aiState.eta}</p>
                    </div>
                </div>
            </div>
        </div>

        {/* SENTIMENT & ANALYTICS */}
        <div className="flex-1 bg-white/5 border border-white/10 p-8 rounded-3xl space-y-6 relative overflow-hidden flex flex-col backdrop-blur-xl shadow-2xl">
            <div className={`absolute -top-20 -right-20 w-64 h-64 blur-[100px] opacity-30 transition-colors duration-1000 ${
                aiState.sentiment === 'Angry' ? 'bg-red-500' : 
                aiState.sentiment === 'Happy' ? 'bg-emerald-500' : 'bg-blue-500'
            }`} />
            
           <div className="relative z-10">
              <p className="text-[11px] text-slate-500 uppercase tracking-widest font-bold mb-2">Detected Intent</p>
              <p className="text-3xl font-bold text-white tracking-tight uppercase">{aiState.intent}</p>
            </div>
            
            <div className="relative z-10">
              <p className="text-[11px] text-slate-500 uppercase tracking-widest font-bold mb-2">Sentiment Analysis</p>
              <p className={`text-4xl font-black tracking-tighter uppercase ${
                  aiState.sentiment === 'Angry' ? 'text-red-400 drop-shadow-[0_0_15px_rgba(248,113,113,0.4)]' : 
                  aiState.sentiment === 'Happy' ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.4)]' : 
                  'text-blue-400'
              }`}>
                {aiState.sentiment}
              </p>
            </div>
            
            <div className="mt-auto bg-black/40 p-5 rounded-2xl border border-white/5 relative z-10 shadow-inner">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500 mb-2 flex items-center gap-2">
                  <ShieldAlert size={16}/> Manager Insight
              </p>
              <p className="text-sm font-medium text-slate-300 leading-relaxed italic">
                  "{aiState.note}"
              </p>
            </div>
        </div>
      </div>
    </div>
  );
}

export default App;