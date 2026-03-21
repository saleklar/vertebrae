// Panel UI for Spine hierarchy and animation selection
import React from 'react';
import { SpineSkeleton } from './SpineTypes';

interface SpineImporterPanelProps {
  skeleton: SpineSkeleton | null;
  onSelectAnimation: (animationName: string) => void;
  mode: '2d' | '3d';
  setMode: (mode: '2d' | '3d') => void;
}

export function SpineImporterPanel({ skeleton, onSelectAnimation, mode, setMode }: SpineImporterPanelProps) {
  return (
    <div>
      <h2>Spine Importer Panel</h2>
      <div>
        <label>
          <input
            type="radio"
            checked={mode === '2d'}
            onChange={() => setMode('2d')}
          />
          2D
        </label>
        <label>
          <input
            type="radio"
            checked={mode === '3d'}
            onChange={() => setMode('3d')}
          />
          3D
        </label>
      </div>
      {skeleton && (
        <div>
          <h3>Hierarchy</h3>
          <ul>
            {skeleton.bones.map(bone => (
              <li key={bone.name}>{bone.name}</li>
            ))}
          </ul>
          <h3>Animations</h3>
          <ul>
            {skeleton.animations.map(anim => (
              <li key={anim.name}>
                <button onClick={() => onSelectAnimation(anim.name)}>{anim.name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
