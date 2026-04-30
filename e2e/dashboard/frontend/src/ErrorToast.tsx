import { createContext, useCallback, useContext, useRef, useState } from "react";
import s from "./ErrorToast.module.css";

interface Toast { id: number; message: string; }

interface ErrorCtx { showError: (msg: string) => void; }
const Ctx = createContext<ErrorCtx>({ showError: () => {} });

export function useError() { return useContext(Ctx); }

let _next = 1;

export function ErrorToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showError = useCallback((message: string) => {
    const id = _next++;
    setToasts(prev => [...prev, { id, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), 6000));
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ showError }}>
      {children}
      <div className={s.container}>
        {toasts.map(t => (
          <div key={t.id} className={s.toast}>
            <span className={s.icon}>⚠</span>
            <span className={s.msg}>{t.message}</span>
            <button className={s.close} onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
