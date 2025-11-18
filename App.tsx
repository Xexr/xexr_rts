import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from './services/GameEngine';
import { EntityType } from './types';
import { DEFINITIONS } from './constants';
import { GoogleGenAI } from "@google/genai";
import { Zap, Battery, Waves, Shield, Factory, User, Play, AlertTriangle, Mic, Menu, X } from 'lucide-react';

// Helper for audio playback
const playAudio = async (arrayBuffer: ArrayBuffer) => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    // Try decoding as standard audio format (WAV/MP3)
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
  } catch (e) {
    console.log("Fallback to raw PCM");
    // Fallback for raw PCM (Gemini sometimes sends raw)
    const float32Array = new Float32Array(arrayBuffer.byteLength / 2);
    const dataView = new DataView(arrayBuffer);
    for (let i = 0; i < float32Array.length; i++) {
        float32Array[i] = dataView.getInt16(i * 2, true) / 32768;
    }
    const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
  }
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameEngine | null>(null);
  
  // React State for UI
  const [credits, setCredits] = useState(2500);
  const [power, setPower] = useState(0);
  const [wave, setWave] = useState(1);
  const [activeBuild, setActiveBuild] = useState<EntityType | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [production, setProduction] = useState({ barracks: 0, factory: 0 });
  const [hasBuildings, setHasBuildings] = useState({ barracks: false, factory: false });
  
  // Sidebar State
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // EVA State
  const [evaActive, setEvaActive] = useState(false);
  const [evaText, setEvaText] = useState("");

  useEffect(() => {
    if (canvasRef.current && !gameRef.current) {
      const engine = new GameEngine(canvasRef.current);
      gameRef.current = engine;
      
      // Bind UI updates from engine to React
      engine.onUpdateUI = () => {
        setCredits(engine.credits);
        setPower(engine.power);
        setWave(engine.wave);
        
        // Check existing buildings
        setHasBuildings({
            barracks: engine.buildings.some(b => b.type === EntityType.BARRACKS && b.team === 'player'),
            factory: engine.buildings.some(b => b.type === EntityType.FACTORY && b.team === 'player')
        });
        
        // Calc progress %
        const bQueue = engine.productionQueues.barracks;
        const fQueue = engine.productionQueues.factory;
        setProduction({
            barracks: bQueue ? (bQueue.progress / bQueue.total) * 100 : 0,
            factory: fQueue ? (fQueue.progress / fQueue.total) * 100 : 0
        });
      };
      
      engine.onMessage = (msg) => {
        setMessages(prev => [...prev.slice(-4), msg]);
        setTimeout(() => setMessages(prev => prev.slice(1)), 3000);
      };

      engine.onGameOver = () => setGameOver(true);
    }
  }, []);

  // Trigger resize when sidebar toggles
  useEffect(() => {
      const t = setTimeout(() => {
          if (gameRef.current) gameRef.current.resize();
      }, 50);
      return () => clearTimeout(t);
  }, [sidebarOpen]);

  const setBuildMode = (type: EntityType) => {
    if (gameRef.current) {
      gameRef.current.buildMode = type;
      setActiveBuild(type);
    }
  };

  const queueUnit = (type: EntityType, buildingKey: 'barracks' | 'factory') => {
    if (!gameRef.current) return;
    const def = DEFINITIONS[type];
    
    if (gameRef.current.credits < def.cost) {
        gameRef.current.onMessage?.("Insufficient Funds");
        return;
    }
    if (gameRef.current.productionQueues[buildingKey]) {
        gameRef.current.onMessage?.("Production Busy");
        return;
    }
    
    const hasBuilding = hasBuildings[buildingKey];
    if (!hasBuilding) {
        gameRef.current.onMessage?.("Building Required");
        return;
    }

    gameRef.current.credits -= def.cost;
    gameRef.current.productionQueues[buildingKey] = {
        type: type,
        progress: 0,
        total: def.buildTime || 1000
    };
  };

  const consultEVA = useCallback(async () => {
    if (!gameRef.current || evaActive) return;
    setEvaActive(true);
    setEvaText("ESTABLISHING UPLINK...");

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    
    const g = gameRef.current;
    const buildingCounts = g.buildings.filter(b => b.team === 'player')
        .reduce((acc, b) => ({ ...acc, [b.type]: (acc[b.type] || 0) + 1 }), {} as Record<string, number>);
    
    const prompt = `
        You are EVA, a tactical military AI advisor for a Command & Conquer style RTS.
        Analyze situation:
        Credits: ${g.credits}
        Power: ${g.power}
        Wave: ${g.wave}
        Buildings: ${JSON.stringify(buildingCounts)}
        
        Give a 1 sentence robotic command.
        If power < 0, scream LOW POWER.
        If no refinery, demand REFINERY.
    `;

    try {
        // 1. Generate Text
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { role: 'user', parts: [{ text: prompt }] }
        });
        const text = response.text || "UPLINK FAILED";
        
        // Typewriter effect
        let i = 0;
        setEvaText("");
        const interval = setInterval(() => {
            setEvaText(prev => prev + text.charAt(i));
            i++;
            if (i >= text.length) clearInterval(interval);
        }, 30);

        // 2. TTS
        const ttsResponse = await ai.models.generateContent({
             model: 'gemini-2.5-flash-preview-tts',
             contents: { parts: [{ text: text }]},
             config: {
                 responseModalities: ["AUDIO"],
                 speechConfig: {
                     voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" }}
                 }
             }
        });
        
        const audioData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioData) {
             // Base64 to ArrayBuffer
             const binaryString = atob(audioData);
             const bytes = new Uint8Array(binaryString.length);
             for (let i = 0; i < binaryString.length; i++) {
                 bytes[i] = binaryString.charCodeAt(i);
             }
             await playAudio(bytes.buffer);
        }

        setTimeout(() => setEvaActive(false), 8000);
    } catch (e) {
        console.error(e);
        setEvaText("CONNECTION LOST");
        setTimeout(() => setEvaActive(false), 2000);
    }
  }, [evaActive]);

  return (
    <div className="w-full h-screen bg-black text-white flex relative overflow-hidden scanlines">
        
        {/* HUD */}
        <div className="absolute top-4 left-4 flex gap-4 pointer-events-none z-10">
            <div className="bg-black/80 border border-gray-600 px-4 py-2 rounded flex items-center gap-2 shadow-lg backdrop-blur-sm">
                <span className="text-yellow-400 font-bold text-xl">{Math.floor(credits)}</span>
                <span className="text-xs text-gray-400">CREDITS</span>
            </div>
            <div className={`bg-black/80 border px-4 py-2 rounded flex items-center gap-2 shadow-lg backdrop-blur-sm ${power < 0 ? 'border-red-500 animate-pulse' : 'border-gray-600'}`}>
                <Zap className={power < 0 ? 'text-red-500' : 'text-blue-400'} size={18} />
                <span className={`font-bold text-xl ${power < 0 ? 'text-red-500' : 'text-blue-400'}`}>{power}</span>
            </div>
            <div className="bg-black/80 border border-gray-600 px-4 py-2 rounded flex items-center gap-2 shadow-lg backdrop-blur-sm">
                <Waves className="text-red-500" size={18} />
                <span className="text-red-500 font-bold text-xl">{wave}</span>
            </div>
        </div>

        {/* Message Log */}
        <div className="absolute top-20 left-4 flex flex-col gap-2 pointer-events-none z-10">
            {messages.map((m, i) => (
                <div key={i} className="bg-black/60 text-green-400 border-l-2 border-green-500 px-3 py-1 text-sm animate-fade-out">
                    {m}
                </div>
            ))}
        </div>

        {/* Game Canvas */}
        <canvas ref={canvasRef} className="flex-grow cursor-crosshair block min-w-0" />

        {/* Sidebar Toggle Button */}
        <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="absolute top-4 right-4 z-40 bg-gray-900 text-green-500 border border-green-700 p-2 rounded hover:bg-gray-800 shadow-lg"
        >
            {sidebarOpen ? <X size={24}/> : <Menu size={24}/>}
        </button>

        {/* Sidebar */}
        {sidebarOpen && (
            <div className="w-72 shrink-0 bg-gray-900 border-l border-gray-700 flex flex-col z-20 shadow-2xl h-full relative">
                <div className="p-4 border-b border-gray-700 bg-gray-800/50">
                    <h1 className="text-xl font-bold text-green-500 tracking-widest mb-2">TIBERIUM DEFENSE</h1>
                    <button 
                        onClick={consultEVA}
                        disabled={evaActive}
                        className={`w-full flex items-center justify-center gap-2 border border-green-600 p-3 font-mono text-sm text-green-500 hover:bg-green-900/30 transition-all ${evaActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <Mic size={16} /> {evaActive ? 'UPLINK ACTIVE' : 'EVA ADVISOR'}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    <div className="mb-6">
                        <h3 className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-wider">Structures</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <BuildBtn 
                                label="Power Plant" 
                                cost={DEFINITIONS[EntityType.POWER_PLANT].cost} 
                                icon={<Zap size={16}/>}
                                active={activeBuild === EntityType.POWER_PLANT}
                                onClick={() => setBuildMode(EntityType.POWER_PLANT)}
                            />
                            <BuildBtn 
                                label="Refinery" 
                                cost={DEFINITIONS[EntityType.REFINERY].cost} 
                                icon={<Factory size={16}/>}
                                active={activeBuild === EntityType.REFINERY}
                                onClick={() => setBuildMode(EntityType.REFINERY)}
                            />
                            <BuildBtn 
                                label="Barracks" 
                                cost={DEFINITIONS[EntityType.BARRACKS].cost} 
                                icon={<User size={16}/>}
                                active={activeBuild === EntityType.BARRACKS}
                                onClick={() => setBuildMode(EntityType.BARRACKS)}
                            />
                            <BuildBtn 
                                label="Factory" 
                                cost={DEFINITIONS[EntityType.FACTORY].cost} 
                                icon={<Battery size={16}/>}
                                active={activeBuild === EntityType.FACTORY}
                                onClick={() => setBuildMode(EntityType.FACTORY)}
                            />
                            <BuildBtn 
                                label="Cannon" 
                                cost={DEFINITIONS[EntityType.CANNON].cost} 
                                icon={<Shield size={16}/>}
                                active={activeBuild === EntityType.CANNON}
                                onClick={() => setBuildMode(EntityType.CANNON)}
                            />
                        </div>
                    </div>

                    <div>
                        <h3 className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-wider">Units</h3>
                        <div className="grid grid-cols-1 gap-2">
                            <UnitBtn 
                                label="Rifleman"
                                cost={DEFINITIONS[EntityType.INFANTRY].cost}
                                progress={production.barracks}
                                disabled={!hasBuildings.barracks}
                                onClick={() => queueUnit(EntityType.INFANTRY, 'barracks')}
                            />
                            <UnitBtn 
                                label="Tank"
                                cost={DEFINITIONS[EntityType.TANK].cost}
                                progress={production.factory}
                                disabled={!hasBuildings.factory}
                                onClick={() => queueUnit(EntityType.TANK, 'factory')}
                            />
                            <UnitBtn 
                                label="Harvester"
                                cost={DEFINITIONS[EntityType.HARVESTER].cost}
                                progress={production.factory}
                                disabled={!hasBuildings.factory}
                                onClick={() => queueUnit(EntityType.HARVESTER, 'factory')}
                            />
                        </div>
                    </div>
                </div>
                
                <div className="p-3 bg-gray-950 text-[10px] text-gray-500 text-center border-t border-gray-800">
                    L-CLICK: Select / Build <br/>
                    R-CLICK: Move / Attack / Pan Map <br/>
                    (Hold R-Click to Pan)
                </div>
            </div>
        )}

        {/* EVA Modal */}
        {evaActive && (
            <div className="absolute bottom-4 left-4 w-96 bg-black/90 border-2 border-green-500 p-4 font-mono text-green-500 shadow-[0_0_20px_rgba(0,255,0,0.2)] z-50">
                <div className="border-b border-green-800 pb-1 mb-2 text-xs font-bold">EVA TACTICAL LOG</div>
                <div className="text-sm leading-relaxed">{evaText}</div>
            </div>
        )}

        {/* Game Over */}
        {gameOver && (
            <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center">
                <h1 className="text-6xl font-bold text-red-600 mb-4 tracking-tighter">MISSION FAILED</h1>
                <p className="text-gray-400 mb-8">Construction Yard Destroyed</p>
                <button onClick={() => window.location.reload()} className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 font-bold rounded flex items-center gap-2">
                    <Play size={20} /> RESTART MISSION
                </button>
            </div>
        )}
    </div>
  );
}

// Sub-components for buttons to keep main file clean-ish
const BuildBtn = ({ label, cost, icon, active, onClick }: any) => (
    <button 
        onClick={onClick}
        className={`relative flex flex-col items-center justify-center p-3 rounded border transition-all ${active ? 'bg-green-900/50 border-green-400 shadow-[0_0_10px_rgba(0,255,0,0.3)]' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'}`}
    >
        <div className="text-gray-300 mb-1">{icon}</div>
        <span className="text-xs font-bold text-white">{label}</span>
        <span className="text-[10px] text-yellow-500">${cost}</span>
    </button>
);

const UnitBtn = ({ label, cost, progress, disabled, onClick }: any) => (
    <button 
        onClick={onClick}
        disabled={progress > 0 || disabled}
        className={`relative flex items-center justify-between p-3 border rounded transition-all overflow-hidden group ${disabled ? 'bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'}`}
    >
        {/* Progress Bar Background */}
        <div className="absolute left-0 top-0 bottom-0 bg-green-900/50 transition-all duration-100" style={{ width: `${progress}%` }} />
        
        <div className="relative z-10 flex flex-col items-start">
            <span className={`text-sm font-bold ${disabled ? 'text-gray-600' : 'text-white'}`}>{label}</span>
            <span className={`text-xs ${disabled ? 'text-gray-700' : 'text-yellow-500'}`}>${cost}</span>
        </div>
        
        {progress > 0 && <div className="relative z-10 text-xs text-green-400 font-mono">{Math.round(progress)}%</div>}
        {disabled && !progress && <div className="relative z-10 text-xs text-red-900 font-mono">LOCKED</div>}
    </button>
);