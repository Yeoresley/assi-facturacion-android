import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { useState } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene3() {
  const [beat, setBeat] = useState(0);
  useSceneTimer([
    { time: 380, callback: () => setBeat(1) },
    { time: 1020, callback: () => setBeat(2) },
    { time: 1790, callback: () => setBeat(3) },
    { time: 2510, callback: () => setBeat(4) },
    { time: 3220, callback: () => setBeat(5) },
  ]);

  return (
    <motion.section
      className="scene scene--ink film-stage scene--three"
      initial={{ clipPath: 'circle(0% at 72% 54%)', scale: 1.08 }}
      animate={{ clipPath: 'circle(150% at 72% 54%)', scale: 1 }}
      exit={{ clipPath: 'inset(100% 0 0 0)', scale: 1.05 }}
      transition={{ duration: 0.62, ease: EASE }}
    >
      <div className="scene-three-upper">
        <p className="scene-kicker cyan">03 · SEGUIMIENTO DE FACTURAS</p>
        <motion.h2 className="scene-headline scene-three-word" initial={{ x: -40, opacity: 0 }} animate={{ x: beat > 0 ? 0 : -40, opacity: beat > 0 ? 1 : 0 }} transition={{ duration: 0.35, ease: EASE }}>
          ACEPTADA
        </motion.h2>
      </div>
      <div className="scene-three-track">
        <motion.div className="scene-three-track-base" initial={{ scaleX: 0 }} animate={{ scaleX: beat > 0 ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE }} />
        <motion.div className="scene-three-track-dash" animate={{ x: beat >= 1 ? ['0%', '590%'] : '0%' }} transition={{ duration: 1.3, ease: EASE }} />
        <motion.div className="scene-three-ring" animate={beat >= 1 ? { left: beat >= 4 ? '88%' : beat >= 3 ? '67%' : beat >= 2 ? '43%' : '16%', scale: beat >= 4 ? 1.18 : 1 } : { left: '3%' }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
          <motion.span animate={{ rotate: beat >= 3 ? 0 : -80, opacity: beat >= 3 ? 1 : 0 }} transition={{ duration: 0.25 }}>✓</motion.span>
        </motion.div>
        <div className="scene-three-step scene-three-step--one">ENVIADA</div>
        <motion.div className="scene-three-step scene-three-step--two" animate={{ color: beat >= 2 ? '#43c6e8' : '#91aabd' }}>ACEPTADA</motion.div>
        <motion.div className="scene-three-step scene-three-step--three" animate={{ color: beat >= 4 ? '#43c6e8' : '#91aabd' }}>PAGO RECIBIDO</motion.div>
      </div>
      <motion.div className="scene-three-paid" initial={{ scale: 1.3, opacity: 0, rotate: -10 }} animate={{ scale: beat >= 4 ? 1 : 1.3, opacity: beat >= 4 ? 1 : 0, rotate: -5 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
        PAGADA
      </motion.div>
      <motion.p className="scene-support scene-three-copy" initial={{ y: 18, opacity: 0 }} animate={{ y: beat >= 5 ? 0 : 18, opacity: beat >= 5 ? 1 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
        Seguimiento claro, factura a factura.
      </motion.p>
      <motion.div className="scene-three-fold" animate={beat >= 5 ? { scale: 1, rotate: -7, opacity: 1 } : { scale: 0.35, rotate: 0, opacity: 0 }} transition={{ duration: 0.5, ease: EASE }} />
      <span className="scene-counter scene-three-counter">03 / 06</span>
    </motion.section>
  );
}
