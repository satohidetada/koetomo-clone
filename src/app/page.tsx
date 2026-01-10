"use client";
import React, { useState, useEffect, useRef } from 'react';
import type { Peer, MediaConnection } from 'peerjs';

export default function KoetomoClone() {
  const [myId, setMyId] = useState("");
  const [name, setName] = useState("匿名ユーザー");
  const [gender, setGender] = useState("未設定");
  const [posts, setPosts] = useState<{id: string, name: string, gender: string}[]>([]);
  const [inCall, setInCall] = useState(false);
  const [callHistory, setCallHistory] = useState<{id: string, name: string}[]>([]);
  
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // クライアントサイドでのみ実行
    import('peerjs').then(({ Peer }) => {
      const peer = new Peer();
      peerRef.current = peer;

      peer.on('open', (id) => {
        setMyId(id);
      });

      // 着信処理
      peer.on('call', async (call) => {
        if (confirm("着信があります。通話しますか？")) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          call.answer(stream);
          setupCallEvents(call);
        }
      });
    });

    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  // 通話イベントの共通処理
  const setupCallEvents = (call: MediaConnection) => {
    setInCall(true);
    call.on('stream', (remoteStream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play();
      }
    });
    call.on('close', () => endCall());
    
    // 履歴に追加
    setCallHistory(prev => {
      const exists = prev.find(h => h.id === call.peer);
      if (exists) return prev;
      return [...prev, { id: call.peer, name: "通話した相手" }];
    });
  };

  // 通話募集（つぶやき）
  const postCallRequest = () => {
    if (!myId) return;
    const newPost = { id: myId, name, gender };
    // 本来はDBに保存しますが、今回は簡易的にローカル配列に追加
    setPosts([newPost, ...posts]);
    alert("募集を開始しました！ブラウザを閉じずに待機してください。");
  };

  // 発信処理
  const startCall = async (targetPeerId: string) => {
    if (!peerRef.current || inCall) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const call = peerRef.current.call(targetPeerId, stream);
      setupCallEvents(call);
    } catch (err) {
      console.error("マイクの許可が必要です", err);
    }
  };

  const endCall = () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    setInCall(false);
    window.location.reload(); // 接続を完全にリセットするためにリロード
  };

  return (
    <div className="min-h-screen bg-sky-50 p-4 font-sans text-gray-800">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold text-sky-600">ひまつぶし通話</h1>
        <p className="text-xs text-gray-400">My ID: {myId || "接続中..."}</p>
      </header>

      {/* プロフィール設定 */}
      <section className="bg-white p-4 rounded-xl shadow-md mb-6 max-w-md mx-auto">
        <h2 className="font-bold mb-3 border-b pb-2">プロフィール設定</h2>
        <div className="space-y-3">
          <input className="w-full border p-2 rounded" placeholder="名前" value={name} onChange={e => setName(e.target.value)} />
          <select className="w-full border p-2 rounded" value={gender} onChange={e => setGender(e.target.value)}>
            <option>未設定</option>
            <option>男性</option>
            <option>女性</option>
          </select>
          <button onClick={postCallRequest} className="w-full bg-sky-500 text-white py-2 rounded-full font-bold hover:bg-sky-600">
            通話を募集する
          </button>
        </div>
      </section>

      {/* 募集一覧 */}
      <section className="max-w-md mx-auto">
        <h2 className="font-bold mb-3">募集中のみんな</h2>
        <div className="space-y-3">
          {posts.length === 0 && <p className="text-center text-gray-400 text-sm">現在募集はありません</p>}
          {posts.map((post, i) => (
            <div key={i} className="bg-white p-4 rounded-xl shadow-sm flex justify-between items-center border-l-4 border-sky-400">
              <div>
                <p className="font-bold">{post.name} <span className="text-xs text-gray-400">({post.gender})</span></p>
                <p className="text-sm text-gray-500">だれでも通話OKです！</p>
              </div>
              <button 
                onClick={() => startCall(post.id)}
                disabled={inCall || post.id === myId}
                className={`px-4 py-2 rounded-full text-white ${inCall || post.id === myId ? 'bg-gray-300' : 'bg-green-500 hover:bg-green-600'}`}
              >
                {post.id === myId ? "自分の投稿" : (inCall ? "通話中" : "通話する")}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 通話中表示 */}
      {inCall && (
        <div className="fixed inset-0 bg-sky-900/90 flex items-center justify-center z-50 p-4 text-white">
          <div className="text-center">
            <div className="w-24 h-24 bg-sky-400 rounded-full mx-auto mb-6 flex items-center justify-center animate-bounce">
              <span className="text-4xl">📞</span>
            </div>
            <p className="text-2xl font-bold mb-8">通話中...</p>
            <button onClick={endCall} className="bg-red-500 text-white px-10 py-3 rounded-full font-bold text-lg">
              通話を切る
            </button>
          </div>
        </div>
      )}

      {/* 履歴とフォロー */}
      <section className="mt-8 max-w-md mx-auto">
        <h2 className="font-bold mb-3 text-gray-500 text-sm">通話履歴</h2>
        <div className="flex gap-2 overflow-x-auto pb-4">
          {callHistory.map((h, i) => (
            <div key={i} className="bg-white border p-3 rounded-lg shadow-sm min-w-[150px]">
              <p className="text-sm font-bold truncate">{h.name}</p>
              <button className="text-xs text-sky-500 font-bold mt-1">＋フォローする</button>
            </div>
          ))}
        </div>
      </section>

      <audio ref={remoteAudioRef} />
    </div>
  );
}