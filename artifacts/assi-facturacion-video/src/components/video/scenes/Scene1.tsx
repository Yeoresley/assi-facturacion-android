import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { useState } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene1() {
  const [beat, setBeat] = useState(0);
  useSceneTimer([
    { time: 430, callback: () => setBeat(1) },
    { time: 1050, callback: () => setBeat(2) },
    { time: 1910, callback: () => setBeat(3) },
    { time: 3060, callback: () => setBeat(4) },
  ]);

  return (
    <motion.section
      className="scene scene--ink film-stage scene--one"
      initial={{ clipPath: 'inset(0 0 0 100%)', scale: 1.04 }}
      animate={{ clipPath: 'inset(0 0 0 0%)', scale: 1 }}
      exit={{ clipPath: 'inset(0 100% 0 0)', scale: 1.08 }}
      transition={{ duration: 0.56, ease: EASE }}
    >
      <div className="scene-grain" />
      <motion.div
        className="scene-one-head"
        initial={{ x: -42, opacity: 0 }}
        animate={{ x: beat > 0 ? 0 : -42, opacity: beat > 0 ? 1 : 0 }}
        transition={{ duration: 0.46, ease: EASE }}
      >
        <p className="scene-kicker cyan">ASSI · FACTURACIÓN EQUIPO</p>
        <h1 className="scene-headline">
          DEL TRABAJO
          <br />
          <span className="cyan">AL COBRO.</span>
        </h1>
        <p className="scene-support scene-one-support">
          Facturación para equipos remotos
        </p>
      </motion.div>

      <motion.div
        className="scene-one-document doc"
        initial={{ x: 140, rotate: 7, scale: 0.88, opacity: 0 }}
        animate={{
          x: beat >= 1 ? 0 : 140,
          rotate: beat >= 3 ? 1.5 : 0,
          scale: beat >= 1 ? 1 : 0.88,
          opacity: beat >= 1 ? 1 : 0,
        }}
        transition={{ type: 'spring', stiffness: 265, damping: 24, mass: 0.8 }}
      >
        <div className="doc-top">
          <span className="doc-label">ASSI / FACTURA</span>
          <span className="doc-label">N.º 0248</span>
        </div>
        <div className="doc-rule" />
        <div className="doc-label">CLIENTE</div>
        <div className="scene-one-client">Estudio Norte</div>
        <div className="doc-line doc-line--strong" />
        <div className="doc-line doc-line-short" />
        <div className="doc-line" />
        <div className="doc-line doc-line-mid" />
        <div className="scene-one-total">
          <span className="doc-label">TOTAL</span>
          <strong>1.240,00 €</strong>
        </div>
        <motion.div
          className="scene-one-stamp"
          initial={{ scale: 1.55, rotate: -12, opacity: 0 }}
          animate={{ scale: beat >= 2 ? 1 : 1.55, rotate: -7, opacity: beat >= 2 ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 310, damping: 18 }}
        >
          LISTA
        </motion.div>
      </motion.div>

      <motion.div
        className="scene-one-path"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: beat > 1 ? 1 : 0 }}
        transition={{ duration: 0.7, ease: EASE }}
      />
      <motion.div
        className="scene-one-edge"
        animate={beat >= 4 ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0.8 }}
        transition={{ duration: 0.65, ease: EASE }}
      />
      <span className="scene-counter scene-one-counter">01 / 06</span>
    </motion.section>
  );
}
