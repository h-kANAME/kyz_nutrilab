import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (res: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            el: HTMLElement,
            cfg: { theme?: string; size?: string; width?: number; text?: string },
          ) => void;
        };
      };
    };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function LoginScreen() {
  const { loginWithCredential } = useAuth();
  const btnRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.google || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async (res) => {
          try {
            await loginWithCredential(res.credential);
          } catch (e) {
            if (errorRef.current) {
              errorRef.current.textContent = (e as Error).message || 'No se pudo iniciar sesión';
            }
          }
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 280,
        text: 'signin_with',
      });
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [loginWithCredential]);

  return (
    <div className="login-screen">
      <img src="/favicon.svg" alt="" width={72} height={72} />
      <div className="brand">
        KYZ <span>NutriLab</span>
      </div>
      <p>Trackeo de alimentación multi-usuario con asistencia AI. Ingresá con Google.</p>
      {!CLIENT_ID && (
        <p className="muted">Falta VITE_GOOGLE_CLIENT_ID en el entorno.</p>
      )}
      <div ref={btnRef} />
      <p ref={errorRef} style={{ color: 'var(--coral)', minHeight: 20, fontSize: 13 }} />
      <p className="powered-by">Powered by KYZ</p>
    </div>
  );
}
