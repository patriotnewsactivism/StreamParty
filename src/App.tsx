/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  doc, 
  collection, 
  onSnapshot, 
  setDoc, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  User 
} from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Pause, 
  Send, 
  Smile, 
  Users, 
  Video, 
  Upload, 
  LogOut,
  ChevronRight,
  Heart,
  ThumbsUp,
  Laugh,
  Angry,
  Zap
} from 'lucide-react';
import { cn } from './lib/utils';

// --- Types ---

interface RoomState {
  videoUrl: string;
  status: 'playing' | 'paused';
  currentTime: number;
  lastUpdated: number;
  hostId: string;
}

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

interface Reaction {
  id: string;
  userId: string;
  emoji: string;
  timestamp: number;
}

// --- Constants ---

const DEFAULT_VIDEOS = [
  { name: 'Big Buck Bunny', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
  { name: 'Elephants Dream', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4' },
  { name: 'Sintel', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' },
];

const REACTION_EMOJIS = [
  { icon: Heart, color: 'text-red-500', label: '❤️' },
  { icon: ThumbsUp, color: 'text-blue-500', label: '👍' },
  { icon: Laugh, color: 'text-yellow-500', label: '😂' },
  { icon: Zap, color: 'text-purple-500', label: '😮' },
  { icon: Angry, color: 'text-orange-500', label: '😡' },
];

const ROOM_ID = 'main-party';

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [isHost, setIsHost] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncIgnoreRef = useRef(false);

  // Auth
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  // Room State Sync
  useEffect(() => {
    if (!user) return;

    const roomRef = doc(db, 'rooms', ROOM_ID);
    return onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as RoomState;
        setRoomState(data);
        setIsHost(data.hostId === user.uid);

        // Sync local video player
        if (videoRef.current && !syncIgnoreRef.current) {
          const timeDiff = Math.abs(videoRef.current.currentTime - data.currentTime);
          
          // If we are significantly out of sync or status changed
          if (timeDiff > 2 || (data.status === 'playing' && videoRef.current.paused) || (data.status === 'paused' && !videoRef.current.paused)) {
            videoRef.current.currentTime = data.currentTime;
            if (data.status === 'playing') {
              videoRef.current.play().catch(() => {});
            } else {
              videoRef.current.pause();
            }
          }
        }
      } else {
        // Initialize room if it doesn't exist
        setDoc(roomRef, {
          videoUrl: DEFAULT_VIDEOS[0].url,
          status: 'paused',
          currentTime: 0,
          lastUpdated: Date.now(),
          hostId: user.uid
        });
      }
    });
  }, [user]);

  // Chat Sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'rooms', ROOM_ID, 'messages'), orderBy('timestamp', 'desc'), limit(50));
    return onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages(msgs.reverse());
    });
  }, [user]);

  // Reactions Sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'rooms', ROOM_ID, 'reactions'), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, (snapshot) => {
      const rs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Reaction));
      // Only keep reactions from the last 5 seconds
      const now = Date.now();
      setReactions(rs.filter(r => now - r.timestamp < 5000));
    });
  }, [user]);

  // Host periodic time sync
  useEffect(() => {
    if (!isHost || !user || roomState?.status !== 'playing') return;
    const interval = setInterval(() => {
      if (videoRef.current) {
        updateRoomState({ currentTime: videoRef.current.currentTime });
      }
    }, 5000); // Sync every 5 seconds
    return () => clearInterval(interval);
  }, [isHost, user, roomState?.status]);

  const handleLogin = () => signInWithPopup(auth, googleProvider);
  const handleLogout = () => auth.signOut();

  const updateRoomState = async (updates: Partial<RoomState>) => {
    if (!user || !roomState) return;
    const roomRef = doc(db, 'rooms', ROOM_ID);
    await setDoc(roomRef, { ...roomState, ...updates, lastUpdated: Date.now() }, { merge: true });
  };

  const handleVideoAction = () => {
    if (!videoRef.current) return;
    const newStatus = videoRef.current.paused ? 'playing' : 'paused';
    updateRoomState({ 
      status: newStatus, 
      currentTime: videoRef.current.currentTime,
      hostId: user?.uid || ''
    });
  };

  const handleSeek = () => {
    if (!videoRef.current) return;
    updateRoomState({ 
      currentTime: videoRef.current.currentTime,
      hostId: user?.uid || ''
    });
  };

  const sendMessage = async (text: string) => {
    if (!user || !text.trim()) return;
    await addDoc(collection(db, 'rooms', ROOM_ID, 'messages'), {
      roomId: ROOM_ID,
      userId: user.uid,
      userName: user.displayName || 'Anonymous',
      text,
      timestamp: Date.now()
    });
  };

  const sendReaction = async (emoji: string) => {
    if (!user) return;
    await addDoc(collection(db, 'rooms', ROOM_ID, 'reactions'), {
      roomId: ROOM_ID,
      userId: user.uid,
      emoji,
      timestamp: Date.now()
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="animate-pulse text-neutral-500 font-mono">INITIALIZING STREAM...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-8"
        >
          <div className="space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/20 text-indigo-500 mb-4">
              <Video size={32} />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white font-sans">StreamParty</h1>
            <p className="text-neutral-400">Watch videos together in real-time with friends.</p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full py-4 px-6 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition-colors flex items-center justify-center gap-3"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col lg:flex-row overflow-hidden">
      {/* Main Content: Video Player */}
      <main className="flex-1 flex flex-col relative min-h-0">
        {/* Header */}
        <header className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Video size={20} />
            </div>
            <div>
              <h2 className="font-bold text-sm leading-tight">StreamParty</h2>
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Live Room: {ROOM_ID}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800">
              <Users size={14} className="text-neutral-500" />
              <span className="text-xs font-medium">1 Online</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-neutral-500 hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {/* Video Area */}
        <div className="flex-1 bg-black relative group flex items-center justify-center overflow-hidden">
          {roomState?.videoUrl ? (
            <video
              ref={videoRef}
              src={roomState.videoUrl}
              className="w-full h-full object-contain"
              onPlay={() => {
                if (!isHost) return;
                updateRoomState({ status: 'playing' });
              }}
              onPause={() => {
                if (!isHost) return;
                updateRoomState({ status: 'paused' });
              }}
              onSeeked={() => {
                if (!isHost) return;
                updateRoomState({ currentTime: videoRef.current?.currentTime || 0 });
              }}
              controls={isHost}
            />
          ) : (
            <div className="text-neutral-700 font-mono text-sm">NO VIDEO SELECTED</div>
          )}

          {/* Reaction Overlay */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <AnimatePresence>
              {reactions.map((r) => (
                <FloatingEmoji key={r.id} emoji={r.emoji} />
              ))}
            </AnimatePresence>
          </div>

          {/* Host Controls Overlay (if not using native controls) */}
          {!isHost && roomState && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-medium flex items-center gap-2">
              <Users size={12} className="text-indigo-400" />
              Watching with {roomState.hostId === user.uid ? 'you' : 'Host'}
            </div>
          )}
        </div>

        {/* Bottom Controls / Video Selection */}
        <div className="p-6 border-t border-neutral-800 bg-neutral-900/30">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">Video Library</h3>
                <p className="text-xs text-neutral-500">Select a video to broadcast to the party.</p>
              </div>
              <label className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer transition-colors text-xs font-medium">
                <Upload size={14} />
                Upload Custom
                <input 
                  type="file" 
                  className="hidden" 
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const url = URL.createObjectURL(file);
                      updateRoomState({ videoUrl: url, currentTime: 0, status: 'paused', hostId: user.uid });
                    }
                  }}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {DEFAULT_VIDEOS.map((v) => (
                <button
                  key={v.url}
                  onClick={() => updateRoomState({ videoUrl: v.url, currentTime: 0, status: 'paused', hostId: user.uid })}
                  className={cn(
                    "p-4 rounded-xl border text-left transition-all group relative overflow-hidden",
                    roomState?.videoUrl === v.url 
                      ? "bg-indigo-600/10 border-indigo-500/50" 
                      : "bg-neutral-900 border-neutral-800 hover:border-neutral-700"
                  )}
                >
                  <div className="relative z-10">
                    <div className="text-xs font-bold mb-1 truncate">{v.name}</div>
                    <div className="text-[10px] text-neutral-500 uppercase tracking-tighter">Public Library</div>
                  </div>
                  {roomState?.videoUrl === v.url && (
                    <div className="absolute top-2 right-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Sidebar: Chat & Reactions */}
      <aside className="w-full lg:w-96 border-l border-neutral-800 flex flex-col bg-neutral-950">
        {/* Reactions Bar */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-around">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji.label}
              onClick={() => sendReaction(emoji.label)}
              className="p-2 rounded-full hover:bg-neutral-900 transition-all active:scale-90 group"
            >
              <emoji.icon className={cn("w-6 h-6 transition-transform group-hover:scale-110", emoji.color)} />
            </button>
          ))}
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-2">
              <Smile size={32} strokeWidth={1} />
              <p className="text-xs font-mono">NO MESSAGES YET</p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                    m.userId === user.uid ? "bg-indigo-600/20 text-indigo-400" : "bg-neutral-800 text-neutral-400"
                  )}>
                    {m.userName}
                  </span>
                  <span className="text-[9px] text-neutral-600 font-mono">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-neutral-300 leading-relaxed">{m.text}</p>
              </div>
            ))
          )}
        </div>

        {/* Chat Input */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/20">
          <ChatInput onSend={sendMessage} />
        </div>
      </aside>
    </div>
  );
}

function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Say something..."
        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
      />
      <button
        type="submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-500 hover:text-indigo-400 transition-colors disabled:opacity-50"
        disabled={!text.trim()}
      >
        <Send size={18} />
      </button>
    </form>
  );
}

function FloatingEmoji({ emoji }: any) {
  const randomX = useMemo(() => Math.random() * 80 + 10, []); // 10% to 90%
  const randomDuration = useMemo(() => 2 + Math.random() * 2, []);
  const randomScale = useMemo(() => 0.8 + Math.random() * 0.5, []);

  return (
    <motion.div
      initial={{ y: '100%', x: `${randomX}%`, opacity: 0, scale: 0 }}
      animate={{ 
        y: '-10%', 
        opacity: [0, 1, 1, 0],
        scale: randomScale,
        x: [`${randomX}%`, `${randomX + (Math.random() * 20 - 10)}%`]
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: randomDuration, ease: "easeOut" }}
      className="absolute bottom-0 text-3xl select-none pointer-events-none z-50"
    >
      {emoji}
    </motion.div>
  );
}
