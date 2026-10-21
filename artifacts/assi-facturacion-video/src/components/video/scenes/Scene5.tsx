import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { useState } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene5() {
  const [beat, setBeat] = useState(0);
  useSceneTimer([
    { time: 430, callback: () => setBeat(1) },
    { time: 1070, callback: () => setBeat(2) },
    { time: 1800, callback: () => setBeat(3) },
    { time: 2510, callback: () => setBeat(4) },
    { time: 3260, callback: () => setBeat(5) },
  ]);

  return (
    <motion.section
      className="scene scene--split film-stage scene--five"
      initial={{ clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)', scale: 1.04 }}
      animate={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', scale: 1 }}
      exit={{ clipPath: 'polygon(0 0, 0 0, 0 100%, 0 100%)', scale: 1.08 }}
      transition={{ duration: 0.58, ease: EASE }}
    >
      <motion.div className="scene-five-cloud" initial={{ x: -80, opacity: 0 }} animate={{ x: beat > 0 ? 0 : -80, opacity: beat > 0 ? 1 : 0 }} transition={{ duration: 0.48, ease: EASE }}>
        <div className="scene-five-platform"><i /><i /><i /></div>
        <span className="scene-five-label">FACTURACIÓN EQUIPO</span>
        <span className="scene-five-caption">Nube · ASSI</span>
      </motion.div>
      <motion.div className="scene-five-desktop" initial={{ x: 80, opacity: 0 }} animate={{ x: beat >= 2 ? 0 : 80, opacity: beat >= 2 ? 1 : 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <div className="desktop-window">
          <div className="desktop-top"><i /><i /><i /></div>
          <div className="desktop-brand">VERSAT</div>
          <div className="desktop-line" />
          <div className="desktop-line desktop-line--short" />
          <div className="desktop-button">IMPORTAR ARCHIVO</div>
        </div>
        <span className="scene-five-label">VERSAT SARASOLA</span>
        <span className="scene-five-caption">Aplicación de escritorio</span>
      </motion.div>

      <motion.div className="scene-five-title" initial={{ y: 20, opacity: 0 }} animate={{ y: beat > 0 ? 0 : 20, opacity: beat > 0 ? 1 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
        <p className="scene-kicker cyan">05 · CONTABILIDAD</p>
        <h2 className="scene-headline">
          EXPORTA <span className="cyan">.FAC</span>
        </h2>
      </motion.div>
      <motion.div className="scene-five-divider" initial={{ scaleY: 0 }} animate={{ scaleY: beat >= 2 ? 1 : 0 }} transition={{ duration: 0.42, ease: EASE }} />
      <motion.div
        className="export-file scene-five-file"
        initial={{ x: '-19vmin', y: '1vmin', rotate: -8, scale: 0.7, opacity: 0 }}
        animate={{
          x: beat >= 3 ? '17vmin' : '-19vmin',
          y: beat >= 3 ? '1vmin' : '1vmin',
          rotate: beat >= 3 ? 0 : -8,
          scale: beat >= 3 ? 1 : 0.7,
          opacity: beat >= 1 ? 1 : 0,
        }}
        transition={{ type: 'spring', stiffness: 245, damping: 24 }}
      >
        <span className="file-fold" />
        <strong>.Fac</strong>
        <small>FACTURA_0248</small>
      </motion.div>
      <motion.div className="scene-five-manual" initial={{ opacity: 0, y: 12 }} animate={{ opacity: beat >= 3 ? 1 : 0, y: beat >= 3 ? 0 : 12 }} transition={{ duration: 0.32, ease: EASE }}>
        Importación manual en Versat Sarasola
      </motion.div>
      <motion.div className="scene-five-honesty" initial={{ opacity: 0 }} animate={{ opacity: beat >= 4 ? 1 : 0 }} transition={{ duration: 0.3 }}>
        Sin sincronización directa
      </motion.div>
      <motion.div className="scene-five-match" animate={beat >= 5 ? { scale: 2.8, opacity: [0, 0.8, 0], rotate: 45 } : { scale: 0, opacity: 0 }} transition={{ duration: 0.72, ease: EASE }} />
      <span className="scene-counter scene-five-counter">05 / 06</span>
    </motion.section>
  );
}
