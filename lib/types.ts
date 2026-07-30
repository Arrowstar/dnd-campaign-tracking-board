export type UserRole = 'player' | 'dm';

export type User = {
  id: string;
  name: string;
  role: UserRole;
  boardId: string;
};

export type ItemType = 'character' | 'npc' | 'faction' | 'event' | 'location' | 'session' | 'quest' | 'note' | 'rule' | 'loot' | 'downtime' | 'image';
export type Visibility = 'all' | 'dm' | 'owner';

export type FieldType = 'text' | 'image' | 'file';

/** A lightweight reference to another board item, stored inside structured field values. */
export type LinkedItemRef = {
  id: string;
  title: string;
  itemType: ItemType;
};


export type AttachedFile = {
  id: string;
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
};

export type ItemField = {
  id: string;
  label: string;
  type: FieldType;
  textValue?: string;
  imageUrl?: string;
  lines?: DrawingLine[];
  files?: AttachedFile[];
};

export type BoardItem = {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  content: string; // JSON string or text depending on type
  date: string;
  color: string;
  tags: string[];
  visibility: Visibility;
  ownerId: string;
  ownerName?: string;
  comments: Comment[];
  // Specific fields for drawing over image
  lines?: DrawingLine[];
  // Custom structured fields for specific item types (e.g., NPC)
  fields?: ItemField[];
  // Whether the item is minimized (collapsed to header only, no preview fields shown)
  minimized?: boolean;
  // Field IDs (FieldDef ids) to show in the compact board card preview.
  // When undefined, a sensible per-type default is used.
  previewFields?: string[];
};

export type DrawingLine = {
  tool: 'pen' | 'eraser';
  color: string;
  points: number[];
};

export type Comment = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
};

export type Connection = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  width?: number;
};

export type AnnotationType = 'line' | 'arrow' | 'double_arrow' | 'circle' | 'rectangle' | 'text';

export type AnnotationFontStyle = {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
};

export type BoardAnnotationPin = {
  itemId: string;
  offsetX: number;
  offsetY: number;
};

export type BoardAnnotation = {
  id: string;
  type: AnnotationType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  text?: string;
  fontStyle?: AnnotationFontStyle;
  pins?: (BoardAnnotationPin | null)[];
  ownerId?: string;
  ownerName?: string;
};

export type BoardTab = {
  id: string;
  name: string;
  color: string;
  items: BoardItem[];
  connections: Connection[];
  annotations?: BoardAnnotation[];
};

export type BoardState = {
  tabs?: BoardTab[];
  activeTabId?: string;
  items?: BoardItem[];
  connections?: Connection[];
  annotations?: BoardAnnotation[];
};
