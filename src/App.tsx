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
  status?: 'sending' | 'sent' | 'delivered';
}

interface Reaction {
  id: string;
  userId: string;
  emoji: string;
  timestamp: number;
}

interface UserPresence {
  uid: string;
  displayName: string;
  lastSeen: number;
  isOnline: boolean;
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
  const [videoLoading, setVideoLoading] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [isHost, setIsHost] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncIgnoreRef = useRef(false);
  const presenceRef = useRef<any>(null);

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
        const wasHost = isHost;
        const newIsHost = data.hostId === user.uid;

        setRoomState(data);
        setIsHost(newIsHost);

        // Sync local video player with improved logic
        if (videoRef.current && !syncIgnoreRef.current) {
          const video = videoRef.current;
          const timeDiff = Math.abs(video.currentTime - data.currentTime);
          const timeSinceUpdate = Date.now() - data.lastUpdated;

          // Only sync if we're not the host or if the update is recent (< 5 seconds)
          if (!newIsHost || timeSinceUpdate < 5000) {
            // If we're significantly out of sync (more than 1 second) or status changed
            if (timeDiff > 1 || (data.status === 'playing' && video.paused) || (data.status === 'paused' && !video.paused)) {
              // Use a timeout to prevent rapid syncs that could cause stuttering
              setTimeout(() => {
                if (video && !syncIgnoreRef.current) {
                  video.currentTime = data.currentTime;
                  if (data.status === 'playing') {
                    video.play().catch(() => {
                      // Handle autoplay restrictions gracefully
                      console.log('Autoplay prevented, waiting for user interaction');
                    });
                  } else {
                    video.pause();
                  }
                }
              }, 100); // Small delay to batch rapid updates
            }
          }
        }
      } else {
        // Initialize room if it doesn't exist with better default state
        setDoc(roomRef, {
          videoUrl: DEFAULT_VIDEOS[0].url,
          status: 'paused',
          currentTime: 0,
          lastUpdated: Date.now(),
          hostId: user.uid
        });
      }
    });
  }, [user, isHost]);

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

  // User Presence Tracking
  useEffect(() => {
    if (!user) return;

    const presenceDocRef = doc(db, 'rooms', ROOM_ID, 'presence', user.uid);

    // Set up presence
    presenceRef.current = {
      uid: user.uid,
      displayName: user.displayName || 'Anonymous',
      lastSeen: Date.now(),
      isOnline: true
    };

    // Update presence on activity
    const updatePresence = () => {
      setDoc(presenceDocRef, {
        ...presenceRef.current,
        lastSeen: Date.now()
      }, { merge: true });
    };

    // Initial presence update
    updatePresence();

    // Update presence on activity (mouse move, key press, etc.)
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    const handleActivity = () => updatePresence();

    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Regular heartbeat every 30 seconds
    const heartbeatInterval = setInterval(updatePresence, 30000);

    // Listen to all presence documents
    const presenceQuery = query(collection(db, 'rooms', ROOM_ID, 'presence'));
    const unsubscribePresence = onSnapshot(presenceQuery, (snapshot) => {
      const now = Date.now();
      const users = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      } as UserPresence)).filter(user =>
        now - user.lastSeen < 60000 // Consider online if seen within last minute
      );
      setOnlineUsers(users);
    });

    // Cleanup presence on unmount
    const cleanup = () => {
      setDoc(presenceDocRef, {
        ...presenceRef.current,
        isOnline: false,
        lastSeen: Date.now()
      }, { merge: true });
    };

    window.addEventListener('beforeunload', cleanup);

    return () => {
      cleanup();
      clearInterval(heartbeatInterval);
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      window.removeEventListener('beforeunload', cleanup);
      unsubscribePresence();
    };
  }, [user]);

  // Host periodic time sync with improved frequency
  useEffect(() => {
    if (!isHost || !user || roomState?.status !== 'playing') return;

    const interval = setInterval(() => {
      if (videoRef.current && !syncIgnoreRef.current) {
        const currentTime = videoRef.current.currentTime;
        // Only update if there's been significant change (>0.5 seconds)
        if (!roomState || Math.abs(currentTime - roomState.currentTime) > 0.5) {
          updateRoomState({ currentTime });
        }
      }
    }, 2000); // More frequent syncs for better accuracy

    return () => clearInterval(interval);
  }, [isHost, user, roomState?.status, roomState?.currentTime]);

  const handleLogin = () => signInWithPopup(auth, googleProvider);
  const handleLogout = () => auth.signOut();

  const updateRoomState = async (updates: Partial<RoomState>) => {
    if (!user || !roomState) return;
    const roomRef = doc(db, 'rooms', ROOM_ID);
    await setDoc(roomRef, { ...roomState, ...updates, lastUpdated: Date.now() }, { merge: true });
  };

  const handleVideoAction = () => {
    if (!videoRef.current || !isHost) return;

    syncIgnoreRef.current = true;
    const newStatus = videoRef.current.paused ? 'playing' : 'paused';

    updateRoomState({
      status: newStatus,
      currentTime: videoRef.current.currentTime,
      hostId: user?.uid || ''
    });

    // Reset sync ignore after a short delay
    setTimeout(() => {
      syncIgnoreRef.current = false;
    }, 500);
  };

  const handleSeek = () => {
    if (!videoRef.current || !isHost) return;

    syncIgnoreRef.current = true;

    updateRoomState({
      currentTime: videoRef.current.currentTime,
      hostId: user?.uid || ''
    });

    // Reset sync ignore after a short delay
    setTimeout(() => {
      syncIgnoreRef.current = false;
    }, 500);
  };

  const sendMessage = async (text: string) => {
    if (!user || !text.trim()) return;

    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      userId: user.uid,
      userName: user.displayName || 'Anonymous',
      text,
      timestamp: Date.now(),
      status: 'sending'
    };

    // Optimistically add message to UI
    setMessages(prev => [...prev, tempMessage]);

    try {
      await addDoc(collection(db, 'rooms', ROOM_ID, 'messages'), {
        roomId: ROOM_ID,
        userId: user.uid,
        userName: user.displayName || 'Anonymous',
        text,
        timestamp: Date.now()
      });

      // Update status to sent
      setMessages(prev => prev.map(msg =>
        msg.id === tempMessage.id ? { ...msg, status: 'sent' as const } : msg
      ));
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove failed message
      setMessages(prev => prev.filter(msg => msg.id !== tempMessage.id));
    }
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
      <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0">
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-indigo-500/20 rounded-full"
              initial={{
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                scale: 0
              }}
              animate={{
                scale: [0, 1, 0],
                opacity: [0, 0.5, 0]
              }}
              transition={{
                duration: 3,
                delay: Math.random() * 2,
                repeat: Infinity,
                repeatDelay: Math.random() * 3
              }}
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`
              }}
            />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="max-w-md w-full space-y-8 relative z-10"
        >
          <div className="space-y-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white mb-6 shadow-2xl shadow-indigo-500/25"
            >
              <Video size={36} />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-5xl font-bold tracking-tight text-white font-sans bg-gradient-to-r from-white to-neutral-300 bg-clip-text text-transparent"
            >
              StreamParty
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-neutral-400 text-lg"
            >
              Watch videos together in real-time with friends.
            </motion.p>
          </div>

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleLogin}
            className="w-full py-4 px-6 bg-gradient-to-r from-white to-neutral-200 text-black font-semibold rounded-xl hover:shadow-xl hover:shadow-white/20 transition-all duration-200 flex items-center justify-center gap-3 group"
          >
            <motion.img
              src="https://www.google.com/favicon.ico"
              className="w-5 h-5"
              alt="Google"
              whileHover={{ rotate: 360 }}
              transition={{ duration: 0.5 }}
            />
            <span>Sign in with Google</span>
            <motion.div
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              initial={false}
              animate={{ x: [0, 5, 0] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              →
            </motion.div>
          </motion.button>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="text-xs text-neutral-500 text-center"
          >
            Join thousands of viewers watching together
          </motion.div>
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
              <span className="text-xs font-medium">{onlineUsers.length} Online</span>
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
            <>
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
                controls={false} // We'll use custom controls
                onLoadedData={() => setVideoLoading(false)}
                onLoadStart={() => setVideoLoading(true)}
              />

              {/* Custom Video Controls Overlay */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {/* Center Play/Pause Button */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={handleVideoAction}
                    className={cn(
                      "p-4 rounded-full bg-black/60 backdrop-blur-md border border-white/20",
                      "hover:bg-black/80 hover:border-white/40 transition-all duration-200",
                      "transform hover:scale-110 active:scale-95",
                      isHost ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                    )}
                    disabled={!isHost}
                  >
                    {roomState?.status === 'playing' ? (
                      <Pause size={32} className="text-white" />
                    ) : (
                      <Play size={32} className="text-white ml-1" />
                    )}
                  </button>
                </div>

                {/* Bottom Controls Bar */}
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center gap-4 text-white">
                    {/* Progress Bar */}
                    <div className="flex-1 relative">
                      <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-200"
                          style={{
                            width: videoRef.current ? `${(videoRef.current.currentTime / videoRef.current.duration) * 100}%` : '0%'
                          }}
                        />
                      </div>
                    </div>

                    {/* Time Display */}
                    <div className="text-xs font-mono text-neutral-300">
                      {videoRef.current ? (
                        <>
                          {Math.floor(videoRef.current.currentTime / 60)}:{(videoRef.current.currentTime % 60).toFixed(0).padStart(2, '0')} / {' '}
                          {Math.floor((videoRef.current.duration || 0) / 60)}:{((videoRef.current.duration || 0) % 60).toFixed(0).padStart(2, '0')}
                        </>
                      ) : (
                        '0:00 / 0:00'
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-neutral-700 font-mono text-sm">NO VIDEO SELECTED</div>
          )}

          {/* Loading Overlay */}
          {videoLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-500 border-t-transparent"></div>
            </div>
          )}

          {/* Reaction Overlay */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <AnimatePresence>
              {reactions.map((r) => (
                <FloatingEmoji key={r.id} emoji={r.emoji} />
              ))}
            </AnimatePresence>
          </div>

          {/* Host Status Overlay */}
          {!isHost && roomState && (
            <div className="absolute top-6 left-6 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Watching with Host
            </div>
          )}

          {/* Host Controls Hint */}
          {isHost && roomState?.status === 'paused' && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-indigo-600/80 backdrop-blur-md text-xs font-medium text-white animate-pulse">
              Click play to start watching together
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
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-2">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2 }}
              >
                <Smile size={32} strokeWidth={1} />
              </motion.div>
              <p className="text-xs font-mono">NO MESSAGES YET</p>
              <p className="text-xs text-neutral-500">Start the conversation!</p>
            </div>
          ) : (
            messages.map((m, index) => {
              const isOwnMessage = m.userId === user.uid;
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    "flex gap-3 max-w-[85%]",
                    isOwnMessage ? "ml-auto flex-row-reverse" : ""
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                    isOwnMessage ? "bg-indigo-600 text-white" : "bg-neutral-700 text-neutral-300"
                  )}>
                    {m.userName.charAt(0).toUpperCase()}
                  </div>

                  {/* Message Bubble */}
                  <div className={cn(
                    "flex flex-col gap-1",
                    isOwnMessage ? "items-end" : "items-start"
                  )}>
                    {/* Username and time */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-neutral-400">
                        {isOwnMessage ? 'You' : m.userName}
                      </span>
                      <span className="text-[9px] text-neutral-600 font-mono">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Message text */}
                    <div className={cn(
                      "px-3 py-2 rounded-2xl text-sm leading-relaxed break-words",
                      isOwnMessage
                        ? "bg-indigo-600 text-white rounded-br-md"
                        : "bg-neutral-800 text-neutral-200 rounded-bl-md"
                    )}>
                      {m.text}
                    </div>

                    {/* Message status for own messages */}
                    {isOwnMessage && m.status && (
                      <div className="flex items-center gap-1 text-xs text-neutral-500">
                        {m.status === 'sending' && <div className="animate-spin rounded-full h-3 w-3 border border-current border-t-transparent" />}
                        {m.status === 'sent' && <div className="w-1.5 h-1.5 rounded-full bg-neutral-500" />}
                        <span className="text-[10px]">{m.status}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })
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
  const [isTyping, setIsTyping] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
    setIsTyping(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    setIsTyping(e.target.value.length > 0);
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={text}
          onChange={handleChange}
          placeholder="Say something..."
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-neutral-600"
          maxLength={500}
        />
        <button
          type="submit"
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all duration-200",
            text.trim()
              ? "text-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/10"
              : "text-neutral-600 cursor-not-allowed"
          )}
          disabled={!text.trim()}
        >
          <Send size={18} />
        </button>
      </form>

      {/* Character count */}
      {text.length > 400 && (
        <div className="text-xs text-neutral-500 text-right">
          {text.length}/500
        </div>
      )}

      {/* Typing indicator */}
      {isTyping && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-2 text-xs text-neutral-500"
        >
          <div className="flex gap-1">
            <div className="w-1 h-1 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          Typing...
        </motion.div>
      )}
    </div>
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
