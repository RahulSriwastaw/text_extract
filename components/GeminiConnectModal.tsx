import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  LogOut,
  Lock,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getAiSettings, saveAiSettings, clearAiCredentials, AiSettings } from '../services/aiDbService';
import { testGeminiApiKey, parseUserApiKeys } from '../services/userGeminiService';

interface GeminiConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

const GeminiConnectModal: React.FC<GeminiConnectModalProps> = ({ isOpen, onClose, onConnected }) => {
  const [activeTab, setActiveTab] = useState<'chrome_key' | 'oauth'>('chrome_key');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    const s = await getAiSettings();
    setSettings(s);
    if (s.apiKey) {
      setApiKeyInput(s.apiKey);
    }
    const envClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
    setClientIdInput(envClientId || localStorage.getItem('user_google_client_id') || '');
    setStatusMessage(null);
  };

  const handleSaveApiKey = async () => {
    const detected = parseUserApiKeys(apiKeyInput);
    if (detected.length === 0) {
      setStatusMessage({ type: 'error', text: 'Please enter at least one valid Gemini API key (starts with AIza... or AQ...).' });
      return;
    }

    setIsVerifying(true);
    setStatusMessage({
      type: 'info',
      text: detected.length > 1
        ? `Verifying ${detected.length} Gemini API keys with Google...`
        : 'Verifying with Google Gemini API...'
    });

    const verification = await testGeminiApiKey(apiKeyInput);
    setIsVerifying(false);

    if (verification.success) {
      await saveAiSettings({
        authType: 'apikey',
        apiKey: detected.join(',')
      });
      await loadSettings();
      setStatusMessage({
        type: 'success',
        text: detected.length > 1
          ? `Connected ${detected.length} Gemini API keys! Automatic load-balancing & rotation is active.`
          : 'Connected successfully with your Gemini account! Unlimited extraction active.'
      });
      if (onConnected) onConnected();
      setTimeout(() => {
        onClose();
      }, 1200);
    } else {
      setStatusMessage({ type: 'error', text: verification.message });
    }
  };

  const handleDisconnect = async () => {
    await clearAiCredentials();
    await loadSettings();
    setApiKeyInput('');
    setStatusMessage({ type: 'info', text: 'Disconnected from Gemini. Local conversation history is retained.' });
  };

  // Google OAuth flow
  const handleGoogleOAuthLogin = () => {
    const activeClientId = clientIdInput.trim() || (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
    
    if (!activeClientId) {
      setStatusMessage({
        type: 'error',
        text: 'Please enter your Google OAuth Client ID below, or use the Extension Bridge option.'
      });
      return;
    }

    localStorage.setItem('user_google_client_id', activeClientId);

    if (typeof (window as any).google === 'undefined' || !(window as any).google?.accounts?.oauth2) {
      setStatusMessage({
        type: 'error',
        text: 'Google Identity Services script is loading. Please wait 2 seconds and try again.'
      });
      return;
    }

    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: activeClientId,
        scope: 'https://www.googleapis.com/auth/generative-language',
        callback: async (tokenResponse: any) => {
          if (tokenResponse && tokenResponse.access_token) {
            const expiresIn = tokenResponse.expires_in || 3599;
            await saveAiSettings({
              authType: 'oauth',
              accessToken: tokenResponse.access_token,
              tokenExpiresAt: Date.now() + expiresIn * 1000
            });
            await loadSettings();
            setStatusMessage({ type: 'success', text: 'Google Account connected successfully from Chrome!' });
            if (onConnected) onConnected();
            setTimeout(() => onClose(), 1200);
          } else {
            setStatusMessage({ type: 'error', text: 'Google authorization was cancelled or failed.' });
          }
        }
      });
      client.requestAccessToken();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to start Google OAuth' });
    }
  };

  const isConnected = settings && settings.authType !== 'none' && (settings.apiKey || settings.accessToken);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0A0C14]/85 backdrop-blur-md z-50"
          />

          <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-xl bg-[#121524] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[92vh] overflow-y-auto custom-scrollbar"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] flex items-center justify-center text-white shadow-lg shadow-[#FF6B2B]/20">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                      Connect AI Engine
                    </h3>
                    <p className="text-xs text-slate-400">Connect your Gemini account to start extracting</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Alert if Connected */}
              {isConnected ? (
                <div className="m-5 mb-0 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-emerald-300">
                        Gemini API Connected ({settings?.authType === 'apikey' ? 'Personal API Key' : 'OAuth'})
                      </p>
                      <p className="text-[11px] text-emerald-400/80">Direct API mode is currently configured.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-bold rounded-lg border border-rose-500/20 transition-all"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </div>
              ) : null}

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Method Tabs */}
                <div className="flex p-1 bg-white/[0.04] border border-white/[0.06] rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('chrome_key')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                      activeTab === 'chrome_key'
                        ? 'bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>Gemini API Key</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('oauth')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                      activeTab === 'oauth'
                        ? 'bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Google OAuth</span>
                  </button>
                </div>

                {/* Tab 1: Chrome Google AI Studio Key */}
                {activeTab === 'chrome_key' && (
                  <div className="space-y-3.5">
                    <div className="p-3.5 bg-gradient-to-r from-white/[0.03] to-white/[0.01] border border-white/[0.08] rounded-xl space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-white">
                        <Zap className="w-4 h-4 text-[#FF884D]" />
                        <span>Chrome me pehle se Google login hai?</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Niche diye gaye button par click karein. Ye aapke Chrome ke <strong>existing logged-in Google account</strong> me Google AI Studio kholega.
                      </p>
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/[0.08] hover:bg-white/[0.12] border border-[#FF6B2B]/40 hover:border-[#FF6B2B] text-[#FF884D] hover:text-white rounded-xl text-xs font-bold transition-all shadow"
                      >
                        <span>🔗 Open in Chrome & Copy My Gemini Key</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                        <label className="flex items-center gap-2">
                          <span>Paste Gemini API Key(s):</span>
                          {parseUserApiKeys(apiKeyInput).length > 1 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 flex items-center gap-1">
                              ⚡ {parseUserApiKeys(apiKeyInput).length} Keys (Auto-Rotating)
                            </span>
                          )}
                        </label>
                        <span className="text-[10px] text-slate-400 font-normal">Comma or newline separated</span>
                      </div>
                      <textarea
                        rows={3}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="Paste one or multiple Gemini API keys:&#10;AIzaSy..., AIzaSy..."
                        className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.1] focus:border-[#FF6B2B] rounded-xl text-white text-xs placeholder:text-slate-500 outline-none transition-all font-mono resize-y"
                      />
                      <p className="text-[11px] text-slate-400">
                        Aap ek se zyada keys paste kar sakte hain. Agar ek key par quota limit aayegi to system bina ruke turant agli key par switch kar lega!
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveApiKey}
                      disabled={isVerifying || !apiKeyInput.trim()}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-xl text-xs font-bold hover:shadow-lg hover:shadow-[#FF6B2B]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isVerifying ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Testing Connection with Gemini...
                        </>
                      ) : (
                        'Connect & Save Key'
                      )}
                    </button>
                  </div>
                )}

                {/* Tab 3: Google OAuth / One-Tap */}
                {activeTab === 'oauth' && (
                  <div className="space-y-3.5">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Google OAuth consent dialog ke through directly Chrome account connect karein:
                    </p>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                        <span>Google OAuth Client ID:</span>
                        <a 
                          href="https://console.cloud.google.com/apis/credentials" 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-[10px] text-[#FF884D] hover:underline flex items-center gap-1 font-normal"
                        >
                          Google Cloud Console
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </label>
                      <input
                        type="text"
                        value={clientIdInput}
                        onChange={(e) => setClientIdInput(e.target.value)}
                        placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                        className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.1] focus:border-[#FF6B2B] rounded-xl text-white text-xs placeholder:text-slate-500 outline-none transition-all font-mono text-[11px]"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleGoogleOAuthLogin}
                      className="w-full flex items-center justify-center gap-3 py-2.5 bg-white hover:bg-slate-100 text-slate-900 rounded-xl text-xs font-bold transition-all shadow-md"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                        />
                      </svg>
                      Sign in with Chrome Google Account
                    </button>
                  </div>
                )}

                {/* Status Messages */}
                {statusMessage && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                      statusMessage.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                        : statusMessage.type === 'error'
                        ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                        : 'bg-blue-500/10 border-blue-500/20 text-blue-300'
                    }`}
                  >
                    {statusMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                    {statusMessage.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <span>{statusMessage.text}</span>
                  </div>
                )}

                {/* Privacy & Security Guarantee */}
                <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2 text-[10px] text-slate-400">
                  <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>
                    <strong>100% Client-Side Privacy:</strong> Extension and credentials operate entirely within your local browser. Zero cost, zero server quota.
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default GeminiConnectModal;
