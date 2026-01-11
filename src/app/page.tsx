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
  const [view, setView] = useState<'home' | 'mypage'>('home'); 
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState({ id: "", username: "匿名", gender: "未設定", peer_id: "", icon: "👤" });
  const [posts, setPosts] = useState<any[]>([]);
  const [inCall, setInCall] = useState(false);
  const [isCalling, setIsCalling] = useState(false); // これを追加
  const [isMuted, setIsMuted] = useState(false); 
  const [callHistory, setCallHistory] = useState<{id: string, name: string}[]>([]);
  
  // 新規追加：フォローリスト用State
  const [following, setFollowing] = useState<any[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pendingCallRef = useRef<MediaConnection | null>(null);
  
  // 新規追加：通話終了後に誰をフォローするか判定するための保存用
  const lastActiveCallUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session) {
        setUser(session.user);
        fetchProfile(session.user.id);
        fetchFollowData(session.user.id); // フォロー状況の取得
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

  // --- 着信バグ修正用フック（画面描画を優先させる） ---
  useEffect(() => {
    if (inCall && pendingCallRef.current && !localStreamRef.current) {
      const timer = setTimeout(async () => {
        if (confirm("着信があります。通話しますか？")) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = stream;
            setupCallEvents(pendingCallRef.current!); 
            pendingCallRef.current!.answer(stream);
          } catch (err) {
            alert("マイクの使用を許可してください");
            setInCall(false);
            pendingCallRef.current = null;
          }
        } else {
          pendingCallRef.current!.close();
          setInCall(false);
          pendingCallRef.current = null;
        }
      }, 300); 
      return () => clearTimeout(timer);
    }
  }, [inCall]);

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

  // フォロー・フォロワーデータの取得
  const fetchFollowData = async (userId: string) => {
    const { data: followingData } = await supabase
      .from('follows')
      .select('target_id, profiles!follows_target_id_fkey(id, username, icon, peer_id)')
      .eq('follower_id', userId);
    if (followingData) setFollowing(followingData.map(f => f.profiles));

    const { data: followerData } = await supabase
      .from('follows')
      .select('follower_id, profiles!follows_follower_id_fkey(id, username, icon, peer_id)')
      .eq('target_id', userId);
    if (followerData) setFollowers(followerData.map(f => f.profiles));
  };

  const updateProfile = async () => {
    const { error } = await supabase.from('profiles').update({
      username: profile.username,
      icon: profile.icon
    }).eq('id', user.id);
    
    if (error) alert("更新に失敗しました");
    else {
      alert("プロフィールを更新しました！");
      setView('home'); 
    }
  };

const fetchPosts = async () => {
  // .select('*') からプロフィールの情報を結合する形式に変更
  const { data } = await supabase
    .from('posts')
    .select(`
      id,
      created_at,
      user_id,
      peer_id,
      profiles:user_id (username, icon)
    `)
    .order('created_at', { ascending: false })
    .limit(20);

  if (data) setPosts(data);
};

  const initPeer = async (fixedId: string) => {
    const { Peer } = await import('peerjs');
    if (peerRef.current) peerRef.current.destroy();

    const peer = new (Peer as any)(fixedId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    }) as Peer;
    peerRef.current = peer;

    peer.on('open', (id) => console.log("PeerID opened:", id));
    peer.on('call', async (call: MediaConnection) => {
      pendingCallRef.current = call;
      setInCall(true); 
    });
    peer.on('error', (err) => {
      console.error("PeerJSエラー:", err);
      setInCall(false);
    });
    peer.on('disconnected', () => {
      peer.reconnect();
    });
  };

const setupCallEvents = (call: MediaConnection) => {
  // ここでの setInCall(true) を削除し、下の stream イベント内に移動
  
  call.on('stream', (remoteStream: MediaStream) => {
    setIsCalling(false); // 呼び出し中を終了
    setInCall(true);    // ここで初めて通話中画面にする
    
    const playStream = () => {
      // ...既存の再生処理...
    };
    playStream();
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
  
  // name, icon, gender を含めず user_id だけにする
  const { error } = await supabase.from('posts').insert([{ 
    user_id: user.id, 
    peer_id: profile.peer_id
  }]);
  
  if (error) alert("募集に失敗しました");
  else alert("募集を投稿しました！");
};
  // 相手のUserIdを受け取れるように拡張
const startCall = async (targetPeerId: string, targetUserId?: string) => {
  if (!peerRef.current) return;
  
  // 修正箇所：inCallではなくisCallingをtrueにする
  setIsCalling(true); 
  
  try {
    if (targetUserId) lastActiveCallUserIdRef.current = targetUserId;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    const call = peerRef.current.call(targetPeerId, stream);
    setupCallEvents(call);
  } catch (err) {
    alert("マイクの使用を許可してください。");
    setIsCalling(false); // 失敗時は呼び出し解除
  }
};

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      });
    }
  };

const endCall = async () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    
    setInCall(false);
    setIsCalling(false); // ★この行を追加：呼び出し中フラグもオフにする
    setIsMuted(false);
    pendingCallRef.current = null;

    // 通話終了後にフォロー確認ダイアログを表示
    const targetUserId = lastActiveCallUserIdRef.current;
    if (targetUserId && targetUserId !== user.id) {
      setTimeout(() => {
        // キャンセルボタンで終了した場合はダイアログを出さないように条件追加も可能
        if (confirm("通話が終了しました。相手をフォローしますか？")) {
          handleFollow(targetUserId);
        }
        lastActiveCallUserIdRef.current = null;
      }, 500);
    }
  };
  const handleFollow = async (targetId: string) => {
    const { error } = await supabase
      .from('follows')
      .insert([{ follower_id: user.id, target_id: targetId }]);
    
    if (error) {
      alert("既にフォロー中か、フォローに失敗しました。");
    } else {
      alert("フォローしました！");
      fetchFollowData(user.id); // フォローリストを更新
    }
  };

  const deletePost = async (postId: string) => {
    if (!confirm("自分の募集を削除しますか？")) return;
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', user.id); 

    if (error) alert("削除に失敗しました");
    else fetchPosts(); 
  };

  // --- UI Render ---
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sky-50 p-6 text-black">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
          <h1 className="text-2xl font-bold mb-6 text-sky-600 text-center">KOETALK</h1>
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

  if (view === 'mypage') {
    return (
      <div className="min-h-screen bg-sky-50 p-6 max-w-md mx-auto text-black">
        <button onClick={() => setView('home')} className="text-sky-600 mb-6 font-bold flex items-center">← 戻る</button>
        <h1 className="text-2xl font-bold mb-8">マイページ</h1>
        
        <div className="bg-white p-6 rounded-2xl shadow-md space-y-6 mb-6">
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
          <button onClick={updateProfile} className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold shadow-lg transition">保存する</button>
        </div>

        {/* フォロー・フォロワー数表示 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl shadow-sm text-center">
            <p className="text-xs text-gray-400">フォロー</p>
            <p className="text-xl font-bold">{following.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm text-center">
            <p className="text-xs text-gray-400">フォロワー</p>
            <p className="text-xl font-bold">{followers.length}</p>
          </div>
        </div>

        {/* フォロー一覧 */}
        <h3 className="font-bold text-sky-900 mb-3 text-sm">フォロー中のユーザー</h3>
        <div className="space-y-2 mb-8">
          {following.map(f => (
            <div key={f.id} className="bg-white p-3 rounded-lg flex justify-between items-center shadow-sm">
              <div className="flex items-center gap-2">
                <span>{f.icon}</span>
                <span className="text-sm font-bold">{f.username}</span>
              </div>
              <button onClick={() => startCall(f.peer_id, f.id)} className="bg-green-500 text-white text-xs px-4 py-1 rounded-full font-bold">通話</button>
            </div>
          ))}
          {following.length === 0 && <p className="text-center text-xs text-gray-400 py-4">フォロー中のユーザーはいません</p>}
        </div>

        <button onClick={() => supabase.auth.signOut().then(() => location.reload())} className="w-full mt-4 text-gray-400 text-sm underline hover:text-gray-600">ログアウトする</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sky-50 p-4 max-w-md mx-auto pb-24 text-black">
      <header className="flex justify-between items-center mb-6">
        <div onClick={() => setView('mypage')} className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm cursor-pointer hover:bg-gray-50 transition">
          <span className="text-xl">{profile.icon}</span>
          <span className="font-bold text-sky-800">{profile.username}</span>
          <span className="text-[10px] text-gray-400">▼</span>
        </div>
        <h1 className="text-sky-600 font-black italic">KOETALK</h1>
      </header>

      <section className="bg-white p-4 rounded-xl shadow-md mb-6">
        <p className="text-center text-gray-500 text-xs mb-3">誰かと話したいときは</p>
        <button onClick={postCallRequest} className="w-full bg-sky-500 text-white py-3 rounded-full font-bold shadow-lg hover:bg-sky-600 transition active:scale-95">通話を募集する</button>
      </section>

      <h3 className="font-bold text-sky-900 mb-4 flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
        </span>
        募集中のユーザー
      </h3>

      <div className="space-y-3 mb-8">
        {posts.map(post => (
          <div key={post.id} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-sky-400 flex justify-between items-center transition hover:shadow-md">
            <div className="flex items-center gap-3">
      {/* post.profiles を経由して最新情報を表示 */}
<div className="text-2xl bg-sky-50 w-10 h-10 flex items-center justify-center rounded-full">
  {post.profiles?.icon || "👤"}
</div>
<div>
  <p className="font-bold text-slate-800">{post.profiles?.username || "ユーザー"}</p>
                <p className="text-xs text-gray-400">{new Date(post.created_at).toLocaleTimeString()} 投稿</p>
              </div>
            </div>
            <div className="flex gap-2">
              {post.user_id === user.id ? (
                <button onClick={() => deletePost(post.id)} className="px-4 py-2 text-xs font-bold text-red-500 bg-red-50 rounded-full border border-red-100 hover:bg-red-100">削除</button>
              ) : (
                <button onClick={() => startCall(post.peer_id, post.user_id)} disabled={inCall} className={`px-5 py-2 rounded-full font-bold text-white transition ${inCall ? 'bg-gray-300' : 'bg-green-500 hover:bg-green-600 shadow-md shadow-green-100'}`}>通話</button>
              )}
            </div>
          </div>
        ))}
        {posts.length === 0 && <p className="text-center text-gray-400 py-10">現在募集はありません</p>}
      </div>

      <h3 className="font-bold text-gray-500 text-sm mb-3">履歴（クイックフォロー）</h3>
      <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
        {callHistory.map((h, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border min-w-[120px] text-center border-slate-100">
            <p className="text-xs font-bold mb-2 truncate text-slate-600">{h.id}</p>
            <button onClick={() => handleFollow(h.id)} className="text-[10px] bg-pink-500 text-white px-3 py-1 rounded-full font-bold hover:bg-pink-600 transition">＋フォロー</button>
          </div>
        ))}
        {callHistory.length === 0 && <p className="text-xs text-gray-400">履歴はありません</p>}
      </div>

{/* --- 呼び出し中画面（相手が出るまで表示） --- */}
      {isCalling && (
        <div className="fixed inset-0 bg-sky-900/90 flex flex-col items-center justify-center z-[60] text-white p-6 text-center">
          <div className="w-20 h-20 bg-sky-400 rounded-full flex items-center justify-center animate-pulse mb-6">
            <span className="text-4xl">🔔</span>
          </div>
          <p className="text-xl font-bold mb-2">呼び出し中...</p>
          <p className="text-sky-200 text-sm mb-12">相手が応答するまでお待ちください</p>
          <button onClick={endCall} className="bg-white/20 hover:bg-white/30 text-white px-8 py-3 rounded-full font-bold transition">キャンセル</button>
        </div>
      )}

      {/* --- 通話中画面（声が繋がった後に表示） --- */}
      {inCall && !isCalling && (
        <div className="fixed inset-0 bg-sky-900/95 flex flex-col items-center justify-center z-50 text-white p-6 text-center">
          <div className="w-24 h-24 bg-sky-400 rounded-full flex items-center justify-center animate-bounce mb-6 shadow-2xl shadow-sky-500/50">
            <span className="text-4xl">📞</span>
          </div>
          <p className="text-2xl font-bold mb-2">通話中</p>
          <p className="text-sky-200 text-sm mb-12">相手と繋がっています。マイクに向かって話してください。</p>
          <div className="flex gap-4">
            <button onClick={toggleMute} className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl transition ${isMuted ? 'bg-orange-500 animate-pulse' : 'bg-white/20'}`}>
              {isMuted ? '🔇' : '🎤'}
            </button>
            <button onClick={endCall} className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold text-lg shadow-xl transition-transform active:scale-95">通話を終了</button>
          </div>
          {isMuted && <p className="mt-4 text-orange-400 font-bold">現在ミュート中です</p>}
        </div>
      )}

      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
    </div>
  );
}