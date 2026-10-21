import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { useState } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene2() {
  const [beat, setBeat] = useState(0);
  useSceneTimer([
    { time: 450, callback: () => setBeat(1) },
    { time: 1120, callback: () => setBeat(2) },
    { time: 2070, callback: () => setBeat(3) },
    { time: 2990, callback: () => setBeat(4) },
  ]);

  return (
    <motion.section
      className="scene scene--paper film-stage scene--two"
      initial={{ clipPath: 'inset(0 0 0 100%)', scale: 1.05 }}
      animate={{ clipPath: 'inset(0)', scale: 1 }}
      exit={{ clipPath: 'inset(0 100% 0 0)', scale: 1.04 }}
      transition={{ duration: 0.52, ease: EASE }}
    >
      <div className="scene-two-cyan-band" />
      <motion.div className="scene-two-title" initial={{ y: 28, opacity: 0 }} animate={{ y: beat > 0 ? 0 : 28, opacity: beat > 0 ? 1 : 0 }} transition={{ duration: 0.42, ease: EASE }}>
        <p className="scene-kicker blue">02 · DEL DOCUMENTO AL CLIENTE</p>
        <h2 className="scene-headline scene-two-headline">
          PREPARA.
          <br />
          <span className="blue">COMPARTE.</span>
        </h2>
      </motion.div>
      <motion.div
        className="scene-two-sheet doc"
        initial={{ y: 85, rotate: -3, opacity: 0, scale: 0.93 }}
        animate={{ y: beat >= 1 ? 0 : 85, rotate: -2, opacity: beat >= 1 ? 1 : 0, scale: beat >= 1 ? 1 : 0.93 }}
        transition={{ type: 'spring', stiffness: 240, damping: 25 }}
      >
        <div className="scene-two-doc-head">
          <span className="doc-label">FACTURA · 0248</span>
          <span className="scene-two-pdf">PDF</span>
        </div>
        <div className="doc-rule" />
        <div className="doc-label">ESTUDIO NORTE</div>
        <div className="scene-two-bigline" />
        <div className="doc-line" />
        <div className="doc-line doc-line-mid" />
        <div className="scene-two-amount">1.240,00 €</div>
      </motion.div>
      <motion.div
        className="scene-two-envelope"
        initial={{ y: 65, rotate: 9, opacity: 0, scale: 0.8 }}
        animate={{
          y: beat >= 2 ? 0 : 65,
          rotate: beat >= 2 ? -4 : 9,
          opacity: beat >= 2 ? 1 : 0,
          scale: beat >= 2 ? 1 : 0.8,
        }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <div className="envelope-back" />
        <div className="envelope-fold" />
        <div className="envelope-seal"><span>PDF</span></div>
        <div className="envelope-caption">Factura lista</div>
      </motion.div>
      <div className="scene-two-shares">
        <motion.div className="chip" initial={{ x: 30, opacity: 0 }} animate={{ x: beat >= 3 ? 0 : 30, opacity: beat >= 3 ? 1 : 0 }} transition={{ duration: 0.35, ease: EASE }}>
          <span className="chip-dot" /> Correo
        </motion.div>
        <motion.div className="chip" initial={{ x: 30, opacity: 0 }} animate={{ x: beat >= 4 ? 0 : 30, opacity: beat >= 4 ? 1 : 0 }} transition={{ duration: 0.35, ease: EASE }}>
          <span className="chip-dot" /> WhatsApp
        </motion.div>
      </div>
      <motion.div className="scene-two-seal-push" animate={beat >= 4 ? { scale: 3.2, opacity: [0, 0.8, 0] } : { scale: 0.5, opacity: 0 }} transition={{ duration: 0.75, ease: EASE }} />
      <span className="scene-counter scene-two-counter">02 / 06</span>
    </motion.section>
  );
}
