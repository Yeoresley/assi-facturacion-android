import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import assiMark from '@assets/ASSI(58x58)_1792554774891.png';
import assiWordmark from '@assets/ASSI-275135_1792554774891.png';
import { useState } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene6() {
  const [beat, setBeat] = useState(0);
  useSceneTimer([
    { time: 420, callback: () => setBeat(1) },
    { time: 990, callback: () => setBeat(2) },
    { time: 1660, callback: () => setBeat(3) },
    { time: 2550, callback: () => setBeat(4) },
    { time: 3240, callback: () => setBeat(5) },
  ]);

  return (
    <motion.section
      className="scene scene--paper film-stage scene--six"
      initial={{ clipPath: 'circle(0% at 52% 50%)', scale: 1.1 }}
      animate={{ clipPath: 'circle(150% at 52% 50%)', scale: 1 }}
      exit={{ clipPath: 'inset(0 0 0 100%)', scale: 1.04 }}
      transition={{ duration: 0.68, ease: EASE }}
    >
      <motion.div className="scene-six-ring" initial={{ scale: 0.35, rotate: -50, opacity: 0 }} animate={{ scale: beat > 0 ? 1 : 0.35, rotate: 0, opacity: beat > 0 ? 1 : 0 }} transition={{ type: 'spring', stiffness: 230, damping: 24 }} />
      <motion.img
        className="end-mark scene-six-mark"
        src={assiMark}
        alt=""
        initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
        animate={{ scale: beat > 0 ? 1 : 0.5, opacity: beat > 0 ? 1 : 0, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 21 }}
      />
      <motion.h2 className="scene-six-first" initial={{ y: 26, opacity: 0 }} animate={{ y: beat >= 1 ? 0 : 26, opacity: beat >= 1 ? 1 : 0 }} transition={{ duration: 0.42, ease: EASE }}>
        FACTURAS EN ORDEN.
      </motion.h2>
      <motion.img
        className="end-wordmark scene-six-wordmark"
        src={assiWordmark}
        alt="ASSI"
        initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 0 }}
        animate={{ clipPath: beat >= 2 ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)', opacity: beat >= 2 ? 1 : 0 }}
        transition={{ duration: 0.62, ease: EASE }}
      />
      <motion.h2 className="scene-six-second" initial={{ y: 24, opacity: 0 }} animate={{ y: beat >= 3 ? 0 : 24, opacity: beat >= 3 ? 1 : 0 }} transition={{ duration: 0.42, ease: EASE }}>
        EQUIPO EN MOVIMIENTO.
      </motion.h2>
      <motion.p className="scene-six-product" initial={{ opacity: 0 }} animate={{ opacity: beat >= 3 ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.12 }}>
        Facturación Equipo
      </motion.p>
      <motion.div className="scene-six-rule" initial={{ scaleX: 0 }} animate={{ scaleX: beat >= 4 ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE }} />
      <motion.div className="scene-six-loop-rule" animate={beat >= 5 ? { x: '120%', opacity: [1, 1, 0] } : { x: '-120%', opacity: 0 }} transition={{ duration: 0.7, ease: EASE }} />
      <span className="scene-counter scene-six-counter">ASSI · FACTURACIÓN EQUIPO</span>
    </motion.section>
  );
}
