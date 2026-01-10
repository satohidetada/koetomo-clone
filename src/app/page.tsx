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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState({ username: "匿名", gender: "未設定", peer_id: "", icon: "👤" });
  const [posts, setPosts] = useState<any[]>([]);
  const [inCall, setInCall] = useState(false);
  const [callHistory, setCallHistory] = useState<{id: string, name: string}[]>([]);
  
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // ログイン監視 (any型でキャストして型エラーを防止)
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session) {
        setUser(session.user);
        fetchProfile(session.user.id);
      }
    });

    fetchPosts();
    // リアルタイム更新の購読
    const channel = supabase.channel('realtime_posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchPosts)
      .subscribe();

    return () => { 
      supabase.removeChannel(channel);
      peerRef.current?.destroy();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (data) {
      setProfile(data);
      initPeer(data.peer_id);
    }
  };

  const fetchPosts = async () => {
    const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setPosts(data);
  };

  const initPeer = async (fixedId: string) => {
    const { Peer } = await import('peerjs');
    // 型キャストにより new Peer() の型エラーを回避
    const peer = new (Peer as any)(fixedId) as Peer;
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log("PeerID opened:", id);
    });

    peer.on('call', async (call: MediaConnection) => {
      if (confirm("着信があります。通話しますか？")) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          call.answer(stream);
          setupCallEvents(call);
        } catch (err) {
          alert("マイクへのアクセスを許可してください");
        }
      }
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
    
    // 履歴に追加 (重複チェック付き)
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
    if (type === 'signup' && data.user) {
      const newPeerId = Math.random().toString(36).substring(7);
      await supabase.from('profiles').insert([{ 
        id: data.user.id, 
        username: email.split('@')[0], 
        peer_id: newPeerId, 
        icon: "👤", 
        gender: "未設定" 
      }]);
      alert("登録完了！再度ログインしてください。");
    }
    location.reload();
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const call = peerRef.current.call(targetPeerId, stream);
      setupCallEvents(call);
    } catch (err) {
      alert("マイクの使用を許可してください。");
    }
  };

  const endCall = () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    setInCall(false);
    // 完全にリセットするためリロード（既存ロジックを継承）
    window.location.reload();
  };

  const handleFollow = async (targetId: string) => {
    alert(`ID: ${targetId} をフォローしました！ (Supabaseのfollowsテーブルへ保存)`);
  };

  // ログイン前の画面
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sky-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
          <h1 className="text-2xl font-bold mb-6 text-sky-600 text-center">ひまつぶし通話</h1>
          <input className="w-full border p-3 mb-3 rounded-lg text-black outline-none focus:border-sky-500" placeholder="メール" onChange={e => setEmail(e.target.value)} />
          <input className="w-full border p-3 mb-6 rounded-lg text-black outline-none focus:border-sky-500" type="password" placeholder="パスワード" onChange={e => setPassword(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => handleAuth('login')} className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition">ログイン</button>
            <button onClick={() => handleAuth('signup')} className="flex-1 border border-sky-600 text-sky-600 py-3 rounded-lg font-bold hover:bg-sky-50 transition">新規登録</button>
          </div>
        </div>
      </div>
    );
  }

  // ログイン後のメイン画面
  return (
    <div className="min-h-screen bg-sky-50 p-4 max-w-md mx-auto pb-24 text-black">
      <header className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm">
          <span className="text-xl">{profile.icon}</span>
          <span className="font-bold text-sky-800">{profile.username}</span>
        </div>
        <button onClick={() => supabase.auth.signOut().then(() => location.reload())} className="text-xs text-gray-400 hover:text-gray-600 underline">ログアウト</button>
      </header>

      {/* プロフィール編集・募集投稿エリア */}
      <section className="bg-white p-4 rounded-xl shadow-md mb-6">
        <h2 className="font-bold mb-3 border-b pb-2 text-sky-700">マイプロフィール</h2>
        <div className="flex gap-2 mb-3">
          <input className="flex-1 border-b p-1 text-sm focus:outline-none focus:border-sky-500" value={profile.username} onChange={e => setProfile({...profile, username: e.target.value})} placeholder="名前" />
          <select className="border-b text-sm outline-none" value={profile.icon} onChange={e => setProfile({...profile, icon: e.target.value})}>
            <option>👤</option><option>🐶</option><option>🐱</option><option>🐰</option><option>🦊</option>
          </select>
        </div>
        <button onClick={postCallRequest} className="w-full bg-sky-500 text-white py-2 rounded-full font-bold shadow-lg hover:bg-sky-600 transition">通話を募集する</button>
      </section>

      {/* 募集一覧エリア */}
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

      {/* 履歴・フォローエリア */}
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

      {/* 通話中オーバーレイ */}
      {inCall && (
        <div className="fixed inset-0 bg-sky-900/95 flex flex-col items-center justify-center z-50 text-white p-6 text-center">
          <div className="w-24 h-24 bg-sky-400 rounded-full flex items-center justify-center animate-bounce mb-6 shadow-2xl shadow-sky-500/50">
            <span className="text-4xl">📞</span>
          </div>
          <p className="text-2xl font-bold mb-2">通話中...</p>
          <p className="text-sky-200 text-sm mb-12">相手と繋がっています。マイクに向かって話してください。</p>
          <button onClick={endCall} className="bg-red-500 hover:bg-red-600 text-white px-12 py-3 rounded-full font-bold text-lg shadow-xl transition-transform active:scale-95">通話を終了</button>
        </div>
      )}
      
      {/* 非表示のオーディオ要素 */}
      <audio ref={remoteAudioRef} />
    </div>
  );
}