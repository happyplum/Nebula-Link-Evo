import { memo, useRef, useState } from 'react';
import { Eye, Globe2, ImageOff, ShieldCheck } from 'lucide-react';

const proxyAdapterUrl = import.meta.env.VITE_PROXY_ADAPTER_URL ?? 'http://127.0.0.1:3000';

export const BrowserStage = memo(function BrowserStage({
  url,
  zoom,
  collapsed,
  browserActive,
  candidateSummary,
}: {
  url: string;
  zoom: number;
  collapsed: boolean;
  browserActive: boolean;
  candidateSummary?: string;
}) {
  const mountId = useRef(`semantic-browser-${crypto.randomUUID()}`);
  const [streamFailed, setStreamFailed] = useState(false);

  return (
    <section
      className={`semantic-browser-stage${collapsed ? ' is-collapsed' : ''}`}
      aria-label="只读浏览器画面"
      data-testid="semantic-browser-stage"
      data-mount-id={mountId.current}
    >
      <header className="semantic-browser-chrome">
        <div className="semantic-browser-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="semantic-address">
          <ShieldCheck aria-hidden="true" />
          <span data-testid="browser-url">{url || '尚未设置目标 URL'}</span>
        </div>
        <span className="semantic-readonly">
          <Eye aria-hidden="true" />
          只读观察
        </span>
      </header>
      <div className="semantic-browser-viewport">
        <div className="semantic-browser-canvas" style={{ transform: `scale(${zoom / 100})` }}>
          {browserActive && !streamFailed ? (
            <img
              src={`${proxyAdapterUrl}/debug/api/playwright/screenshot/stream`}
              alt="当前受控浏览器实时画面"
              onError={() => setStreamFailed(true)}
            />
          ) : (
            <div className="semantic-browser-empty">
              {streamFailed ? <ImageOff aria-hidden="true" /> : <Globe2 aria-hidden="true" />}
              <strong>{streamFailed ? '实时画面暂不可用' : '浏览器会话尚未激活'}</strong>
              <p>
                {streamFailed
                  ? '运行与编排状态仍由持久化控制面同步；可检查 proxy-adapter 调试流。'
                  : '手动定位、重新编排或开始运行后，这里会持续显示只读浏览器画面。'}
              </p>
              {streamFailed && (
                <button type="button" onClick={() => setStreamFailed(false)}>
                  重试实时画面
                </button>
              )}
            </div>
          )}
        </div>
        {candidateSummary && (
          <div className="semantic-candidate-overlay">
            <span>候选覆盖层</span>
            <strong>{candidateSummary}</strong>
          </div>
        )}
      </div>
    </section>
  );
});
