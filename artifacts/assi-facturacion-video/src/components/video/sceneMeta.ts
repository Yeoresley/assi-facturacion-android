// Optional scene metadata for Replit workspace integrations. When the
// workspace's scene controls are enabled for this project, a viewer's click on
// a scene segment scopes their next chat request to that scene's source file.
// Fill one entry per SCENE_DURATIONS key in VideoTemplate.tsx only when a
// skill reference asks for it; otherwise leave the map empty. Scenes missing
// from the map still play and can be jumped to.
//
// Example:
//   export const SCENE_DETAILS: Record<string, SceneDetails> = {
//     open: { title: 'Intro', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
//   };

export interface SceneDetails {
  title: string;
  filePath: string;
}

export const SCENE_DETAILS: Record<string, SceneDetails> = {
  invoice: { title: 'Del trabajo al cobro', filePath: 'src/components/video/scenes/Scene1.tsx' },
  share: { title: 'Prepara y comparte', filePath: 'src/components/video/scenes/Scene2.tsx' },
  payment: { title: 'Aceptación y pago', filePath: 'src/components/video/scenes/Scene3.tsx' },
  liquidation: { title: 'Liquidaciones del mes', filePath: 'src/components/video/scenes/Scene4.tsx' },
  export: { title: 'Exportación a Versat', filePath: 'src/components/video/scenes/Scene5.tsx' },
  brand: { title: 'ASSI', filePath: 'src/components/video/scenes/Scene6.tsx' },
};
