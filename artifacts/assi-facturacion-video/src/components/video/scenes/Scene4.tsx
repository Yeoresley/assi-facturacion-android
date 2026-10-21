import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { useState } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene4() {
  const [beat, setBeat] = useState(0);
  useSceneTimer([
    { time: 420, callback: () => setBeat(1) },
    { time: 1040, callback: () => setBeat(2) },
    { time: 1700, callback: () => setBeat(3) },
    { time: 2390, callback: () => setBeat(4) },
    { time: 3170, callback: () => setBeat(5) },
  ]);
  const slips = [
    { x: '-18vmin', y: '-9vmin', r: -11 },
    { x: '12vmin', y: '-10vmin', r: 8 },
    { x: '17vmin', y: '9vmin', r: 12 },
    { x: '-15vmin', y: '11vmin', r: -5 },
  ];

  return (
    <motion.section
      className="scene scene--desk film-stage scene--four"
      initial={{ clipPath: 'inset(0 0 100% 0)', scale: 0.94 }}
      animate={{ clipPath: 'inset(0)', scale: 1 }}
      exit={{ clipPath: 'inset(0 0 0 100%)', scale: 1.06 }}
      transition={{ duration: 0.58, ease: EASE }}
    >
      <div className="scene-four-table-grid" />
      <div className="scene-four-title">
        <p className="scene-kicker blue">04 · CIERRE MENSUAL</p>
        <h2 className="scene-headline">
          LIQUIDACIONES
          <br />
          <span className="blue">DEL MES.</span>
        </h2>
      </div>
      <div className="scene-four-gather">
        {slips.map((slip, index) => (
          <motion.div
            key={index}
            className={`scene-four-slip ledger-card scene-four-slip--${index + 1}`}
            initial={{ x: slip.x, y: slip.y, rotate: slip.r, opacity: 0, scale: 0.75 }}
            animate={{
              x: beat >= 2 ? 0 : slip.x,
              y: beat >= 2 ? 0 : slip.y,
              rotate: beat >= 2 ? 0 : slip.r,
              opacity: beat >= 1 ? 1 : 0,
              scale: beat >= 1 ? 1 : 0.75,
            }}
            transition={{ type: 'spring', stiffness: 250 + index * 12, damping: 22, delay: index * 0.075 }}
          >
            <div className="scene-four-slipline" />
            <div className="scene-four-slipline scene-four-slipline--short" />
            <div className="scene-four-slipamount">{['420', '280', '610', '550'][index]} €</div>
          </motion.div>
        ))}
        <motion.div className="scene-four-statement" initial={{ scale: 0.78, opacity: 0, rotate: -4 }} animate={{ scale: beat >= 2 ? 1 : 0.78, opacity: beat >= 2 ? 1 : 0, rotate: -1 }} transition={{ type: 'spring', stiffness: 240, damping: 24 }}>
          <div className="scene-four-statement-top">
            <span className="doc-label">LIQUIDACIÓN</span>
            <span className="scene-four-month">03 / MARZO</span>
          </div>
          <div className="scene-four-specialist">
            <span className="specialist-avatar">LR</span>
            <span>Especialista</span>
            <strong>Lucía R.</strong>
          </div>
          <div className="scene-four-rule" />
          <div className="doc-label">IMPORTE LIQUIDADO</div>
          <motion.div className="scene-four-total" animate={beat >= 3 ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ duration: 0.45 }}>
            1.860,00 <small>€</small>
          </motion.div>
        </motion.div>
      </div>
      <motion.p className="scene-four-caption" initial={{ opacity: 0, y: 14 }} animate={{ opacity: beat >= 4 ? 1 : 0, y: beat >= 4 ? 0 : 14 }} transition={{ duration: 0.35, ease: EASE }}>
        Cada especialista, su liquidación.
      </motion.p>
      <motion.div className="scene-four-fold" animate={beat >= 5 ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} />
      <span className="scene-counter scene-four-counter">04 / 06</span>
    </motion.section>
  );
}
