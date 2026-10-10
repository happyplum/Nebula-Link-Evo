import type { LiveviewTransport } from '@/features/runtime/store/runtime.store.js';
import styles from './TransportToggle.module.css';

interface TransportToggleProps {
  transport: LiveviewTransport;
  onTransportChange: (mode: LiveviewTransport) => void;
  webrtcAvailable?: boolean;
}

export function TransportToggle({
  transport,
  onTransportChange,
  webrtcAvailable,
}: TransportToggleProps) {
  return (
    <div className={styles.toggle}>
      <button
        type="button"
        className={`${styles.segment}${transport === 'mjpeg' ? ` ${styles.active}` : ''}`}
        onClick={() => onTransportChange('mjpeg')}
        title="MJPEG 流媒体"
      >
        MJPEG
      </button>
      <button
        type="button"
        className={`${styles.segment}${transport === 'webrtc' ? ` ${styles.active}` : ''}${!webrtcAvailable && transport === 'webrtc' ? ` ${styles.degraded}` : ''}`}
        onClick={() => onTransportChange('webrtc')}
        title="WebRTC 低延迟"
      >
        WebRTC
        {!webrtcAvailable && transport === 'webrtc' && <span className={styles.warnDot} />}
      </button>
    </div>
  );
}
