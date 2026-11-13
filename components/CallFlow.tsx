import styles from "./CallFlow.module.css";

/** How a call is answered, drawn from the same four facts as the case study. */
export default function CallFlow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 580 400"
      role="img"
      aria-labelledby="callflow-title callflow-desc"
      className={`${styles.svg} ${className ?? ""}`}
    >
      <title id="callflow-title">How a call is answered</title>
      <desc id="callflow-desc">
        A resident calls. The call routing system passes the call to voice agents that run in
        parallel. The agents draw on the knowledge base, records data and an FAQ bank, then
        answer by voice. Prompts are managed in Langfuse.
      </desc>

      <g className={styles.lines}>
        <path d="M76 150 H104" />
        <path d="M236 150 H266" />
        <path d="M432 150 H470" />
        <path d="M120 330 C120 250 311 262 311 182" />
        <path d="M290 330 C290 262 341 250 341 182" />
        <path d="M460 330 C460 250 371 262 371 182" />
        <path d="M349 56 V102" className={styles.dash} />
      </g>

      {/* Drawn under the boxes, so the dot shows only on the lines between them. */}
      <circle r="6" className={styles.dot} />

      <circle cx="40" cy="150" r="36" className={styles.plain} />
      <text x="40" y="156" textAnchor="middle">Caller</text>

      <rect x="104" y="120" width="132" height="60" rx="12" className={styles.plain} />
      <text x="170" y="156" textAnchor="middle">Call routing</text>

      <rect x="282" y="104" width="150" height="60" rx="12" className={styles.agent} />
      <rect x="274" y="112" width="150" height="60" rx="12" className={styles.agent} />
      <rect x="266" y="120" width="150" height="60" rx="12" className={styles.agent} />
      <text x="341" y="156" textAnchor="middle">Voice agents</text>

      <rect x="470" y="120" width="100" height="60" rx="12" className={styles.plain} />
      <text x="520" y="156" textAnchor="middle">Answer</text>

      <text x="349" y="44" textAnchor="middle" className={styles.note}>
        Prompts managed in Langfuse
      </text>

      <rect x="40" y="330" width="160" height="56" rx="12" className={styles.plain} />
      <text x="120" y="364" textAnchor="middle">Knowledge base</text>
      <rect x="210" y="330" width="160" height="56" rx="12" className={styles.plain} />
      <text x="290" y="364" textAnchor="middle">Records data</text>
      <rect x="380" y="330" width="160" height="56" rx="12" className={styles.plain} />
      <text x="460" y="364" textAnchor="middle">FAQ bank</text>

    </svg>
  );
}
