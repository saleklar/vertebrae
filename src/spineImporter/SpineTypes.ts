// Types for Spine hierarchy and animation
export interface SpineSkeleton {
  bones: SpineBone[];
  slots: SpineSlot[];
  skins: SpineSkin[];
  animations: SpineAnimation[];
}

export interface SpineBone {
  name: string;
  parent?: string;
  // ...other properties
}

export interface SpineSlot {
  name: string;
  bone: string;
  // ...other properties
}

export interface SpineSkin {
  name: string;
  attachments: Record<string, any>;
}

export interface SpineAnimation {
  name: string;
  // ...other properties
}
