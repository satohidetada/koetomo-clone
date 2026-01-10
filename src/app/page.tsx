"use client";
import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Peer, MediaConnection } from 'peerjs';

// --- Supabase設定 ---
const SUPABASE_URL = "https://zutzyawogcnogoohyewy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tqjrnlZIfAoQMNeo_fHkuA_Y4PpQh2N";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function KoetomoApp() {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'home' | 'mypage'>('home'); // 画面切り替え用
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState({ id: "", username: "匿名", gender: "未設定", peer_id: "", icon: "👤" });
  const [posts, setPosts] = useState<any[]>([]);
  const [inCall, setInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false); // ミュート状態管理
  const [callHistory, setCallHistory] = useState<{id: string, name: string}[]>([]);
  
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session) {
        setUser(session.user);
        fetchProfile(session.user.id);
      }
    });

    fetchPosts();
    const channel = supabase.channel('realtime_posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchPosts)
      .subscribe();

    return () => { 
      supabase.removeChannel(channel);
      peerRef.current?.destroy();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId);

    if (data && data.length > 0) {
      const userProfile = data[0];
      setProfile(userProfile);
      if (userProfile.peer_id) {
        initPeer(userProfile.peer_id);
      }
    } else {
      const newPeerId = Math.random().toString(36).substring(7);
      const newProfile = { id: userId, username: "ユーザー", peer_id: newPeerId, icon: "👤", gender: "未設定" };
      await supabase.from('profiles').insert([newProfile]);
      setProfile(newProfile);
      initPeer(newPeerId);
    }
  };

  // マイページ用のプロフィール更新関数
  const updateProfile = async () => {
    const { error } = await supabase.from('profiles').update({
      username: profile.username,
      icon: profile.icon
    }).eq('id', user.id);
    
    if (error) alert("更新に失敗しました");
    else {
      alert("プロフィールを更新しました！");
      setView('home'); // ホームに戻る
    }
  };

  const fetchPosts = async () => {
    const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setPosts(data);
  };

  const initPeer = async (fixedId: string) => {
    const { Peer } = await import('peerjs');
    const peer = new (Peer as any)(fixedId) as Peer;
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log("PeerID opened:", id);
    });

    peer.on('error', (err) => {
      console.error("PeerJSエラー:", err);
    });

    peer.on('disconnected', () => {
      console.log("PeerJS切断。再接続します...");
      peer.reconnect();
    });

    peer.on('call', async (call: MediaConnection) => {
      // 【修正箇所】まず着信中であることを視覚的に伝えるために状態をセット
      setInCall(true); 

      // ブラウザが画面更新を完了してからダイアログを出す
      setTimeout(async () => {
        if (confirm("着信があります。通話しますか？")) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = stream;
            call.answer(stream);
            setupCallEvents(call);
          } catch (err) {
            alert("マイクへのアクセスを許可してください");
            setInCall(false);
          }
        } else {
          call.close();
          setInCall(false);
        }
      }, 500);
    });
  };

  const setupCallEvents = (call: MediaConnection) => {
    setInCall(true);
    call.on('stream', (remoteStream: MediaStream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play();
      }
    });
    
    call.on('close', () => endCall());
    
    setCallHistory(prev => {
      if (prev.find(h => h.id === call.peer)) return prev;
      return [...prev, { id: call.peer, name: "通話した相手" }];
    });
  };

  const handleAuth = async (type: 'login' | 'signup') => {
    const { data, error } = type === 'signup' 
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    
    if (error) return alert(error.message);
    if (data.user) {
      alert(type === 'signup' ? "登録完了！" : "ログイン成功！");
      location.reload();
    }
  };

  const postCallRequest = async () => {
    if (!profile.peer_id) return alert("準備中です...");
    const { error } = await supabase.from('posts').insert([{ 
      user_id: user.id, 
      name: profile.username, 
      gender: profile.gender, 
      peer_id: profile.peer_id 
    }]);
    if (error) alert("募集に失敗しました");
    else alert("募集を投稿しました！");
  };

  const startCall = async (targetPeerId: string) => {
    if (!peerRef.current) return;
    setInCall(true); // 発信側も画面を切り替える
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const call = peerRef.current.call(targetPeerId, stream);
      setupCallEvents(call);
    } catch (err) {
      alert("マイクの使用を許可してください。");
      setInCall(false);
    }
  };

  // --- ミュート切り替え ---
  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      });
    }
  };

  const endCall = () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    setInCall(false);
    setIsMuted(false);
    window.location.reload();
  };

  const handleFollow = async (targetId: string) => {
    alert(`ID: ${targetId} をフォローしました！`);
  };

  // --- ログイン画面 ---
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sky-50 p-6 text-black">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
          <h1 className="text-2xl font-bold mb-6 text-sky-600 text-center">ひまつぶし通話</h1>
          <input className="w-full border p-3 mb-3 rounded-lg outline-none focus:border-sky-500" placeholder="メール" onChange={e => setEmail(e.target.value)} />
          <input className="w-full border p-3 mb-6 rounded-lg outline-none focus:border-sky-500" type="password" placeholder="パスワード" onChange={e => setPassword(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => handleAuth('login')} className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition">ログイン</button>
            <button onClick={() => handleAuth('signup')} className="flex-1 border border-sky-600 text-sky-600 py-3 rounded-lg font-bold hover:bg-sky-50 transition">新規登録</button>
          </div>
        </div>
      </div>
    );
  }

  // --- マイページ画面 ---
  if (view === 'mypage') {
    return (
      <div className="min-h-screen bg-sky-50 p-6 max-w-md mx-auto text-black">
        <button onClick={() => setView('home')} className="text-sky-600 mb-6 font-bold flex items-center">← 戻る</button>
        <h1 className="text-2xl font-bold mb-8">マイページ</h1>
        
        <div className="bg-white p-6 rounded-2xl shadow-md space-y-6">
          <div>
            <label className="text-xs text-gray-400 block mb-1">アイコン</label>
            <select className="w-full border-b p-2 text-2xl outline-none" value={profile.icon} onChange={e => setProfile({...profile, icon: e.target.value})}>
              <option>👤</option><option>🐶</option><option>🐱</option><option>🐰</option><option>🦊</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">ユーザー名</label>
            <input className="w-full border-b p-2 outline-none focus:border-sky-500" value={profile.username} onChange={e => setProfile({...profile, username: e.target.value})} />
          </div>
          <button onClick={updateProfile} className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold shadow-lg active:scale-95 transition">保存する</button>
        </div>
        <button onClick={() => supabase.auth.signOut().then(() => location.reload())} className="w-full mt-12 text-gray-400 text-sm underline hover:text-gray-600">ログアウトする</button>
      </div>
    );
  }

  // --- メイン画面 ---
  return (
    <div className="min-h-screen bg-sky-50 p-4 max-w-md mx-auto pb-24 text-black">
      <header className="flex justify-between items-center mb-6">
        <div onClick={() => setView('mypage')} className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm cursor-pointer hover:bg-gray-50 transition">
          <span className="text-xl">{profile.icon}</span>
          <span className="font-bold text-sky-800">{profile.username}</span>
          <span className="text-[10px] text-gray-400">▼</span>
        </div>
        <h1 className="text-sky-600 font-black">KOETOMO</h1>
      </header>

      <section className="bg-white p-4 rounded-xl shadow-md mb-6">
        <p className="text-center text-gray-500 text-xs mb-3">誰かと話したいときは</p>
        <button onClick={postCallRequest} className="w-full bg-sky-500 text-white py-3 rounded-full font-bold shadow-lg hover:bg-sky-600 transition active:scale-95">通話を募集する</button>
      </section>

      <h3 className="font-bold text-sky-900 mb-4 flex items-center gap-2">
        <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span></span>
        募集中のユーザー
      </h3>

      <div className="space-y-3 mb-8">
        {posts.length === 0 && <p className="text-center text-gray-400 py-10">現在募集はありません</p>}
        {posts.map(post => (
          <div key={post.id} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-sky-400 flex justify-between items-center transition hover:shadow-md">
            <div>
              <p className="font-bold text-slate-800">{post.name}</p>
              <p className="text-xs text-gray-400">{new Date(post.created_at).toLocaleTimeString()} 投稿</p>
            </div>
            <button 
              onClick={() => startCall(post.peer_id)} 
              disabled={inCall || post.peer_id === profile.peer_id} 
              className={`px-5 py-2 rounded-full font-bold text-white transition ${inCall || post.peer_id === profile.peer_id ? 'bg-gray-300' : 'bg-green-500 hover:bg-green-600 shadow-md shadow-green-100'}`}
            >
              {post.peer_id === profile.peer_id ? "自分の投稿" : "通話"}
            </button>
          </div>
        ))}
      </div>

      <h3 className="font-bold text-gray-500 text-sm mb-3">通話履歴（フォロー）</h3>
      <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
        {callHistory.length === 0 && <p className="text-xs text-gray-400">履歴はありません</p>}
        {callHistory.map((h, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border min-w-[120px] text-center border-slate-100">
            <p className="text-xs font-bold mb-2 truncate text-slate-600">{h.id}</p>
            <button onClick={() => handleFollow(h.id)} className="text-[10px] bg-pink-500 text-white px-3 py-1 rounded-full font-bold hover:bg-pink-600 transition">＋フォロー</button>
          </div>
        ))}
      </div>

      {inCall && (
        <div className="fixed inset-0 bg-sky-900/95 flex flex-col items-center justify-center z-50 text-white p-6 text-center">
          <div className="w-24 h-24 bg-sky-400 rounded-full flex items-center justify-center animate-bounce mb-6 shadow-2xl shadow-sky-500/50">
            <span className="text-4xl">📞</span>
          </div>
          <p className="text-2xl font-bold mb-2">通話中...</p>
          <p className="text-sky-200 text-sm mb-12">相手と繋がっています。マイクに向かって話してください。</p>
          
          <div className="flex gap-4">
            <button 
              onClick={toggleMute} 
              className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl transition ${isMuted ? 'bg-orange-500 animate-pulse' : 'bg-white/20'}`}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            <button onClick={endCall} className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold text-lg shadow-xl transition-transform active:scale-95">通話を終了</button>
          </div>
          {isMuted && <p className="mt-4 text-orange-400 font-bold">現在ミュート中です</p>}
        </div>
      )}
      <audio ref={remoteAudioRef} />
    </div>
  );
}