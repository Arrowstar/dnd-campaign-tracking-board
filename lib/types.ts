export type UserRole = 'player' | 'dm';

export type User = {
  id: string;
  name: string;
  role: UserRole;
  boardId: string;
  /** Server-issued session token — stored in localStorage as `dnd_session` */
  sessionToken: string;
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

/** Normalized crop rectangle (0..1) relative to an image's native space. */
export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ItemField = {
  id: string;
  label: string;
  type: FieldType;
  textValue?: string;
  imageUrl?: string;
  /** Mask-only crop: keeps the original imageUrl and stores the kept rectangle. */
  crop?: CropRect;
  lines?: DrawingLine[];
  files?: AttachedFile[];
  /** Per-field visibility. Undefined/'all' = everyone on the board can see it.
   *  'dm' = only the DM. 'owner' = only the item's owner. */
  visibility?: Visibility;
};

export type PreviewFieldMode = 'auto' | 'hero' | 'thumb' | 'natural' | 'fill' | 'compact' | 'expanded';

export type PreviewFieldSlot = {
  /** FieldDef id (or '__image_content__' sentinel for image-type items). */
  fieldId: string;
  /** Grid columns occupied (1 = one column, up to the layout's column count = full row). */
  span?: 1 | 2 | 3 | 4;
  /** How the field renders in the card preview. 'auto' picks a sensible default per field type. */
  mode?: PreviewFieldMode;
  /** Line clamp for rich text previews. Ignored when mode is 'expanded'. */
  clampLines?: 2 | 4 | 8;
};

export type PreviewLayout = {
  /** Number of columns in the card preview grid. */
  columns: 1 | 2 | 3 | 4;
  /** Relative width per column (fractions summing to 1). Undefined = equal widths. */
  columnWidths?: number[];
  /** Ordered list of preview slots. */
  rows: PreviewFieldSlot[];
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
  /** Mask-only crop for `type: 'image'` items whose image lives in `content`. */
  crop?: CropRect;
  // Custom structured fields for specific item types (e.g., NPC)
  fields?: ItemField[];
  // Whether the item is minimized (collapsed to header only, no preview fields shown)
  minimized?: boolean;
  // Field IDs (FieldDef ids) to show in the compact board card preview.
  // When undefined, a sensible per-type default is used.
  previewFields?: string[];
  // Fine-grained card preview layout (columns + ordered slots with per-field
  // width/display-mode controls). When undefined, it is derived from
  // previewFields (or per-type defaults) for backwards compatibility.
  previewLayout?: PreviewLayout;
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
  /** Rotation in degrees (clockwise, 0 = none), pivoting around the shape's center. */
  rotation?: number;
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

/**
 * Board-wide settings managed by the DM (Board Settings dialog). Stored in
 * the boards.settings JSONB column. Fields are optional so new settings can
 * be added without migrating existing rows.
 */
export type BoardSettings = {
  /** Multiplier applied to every piece of text on canvas board-item cards (1 = 100%). */
  cardFontScale?: number;
};

export type BoardState = {
  tabs?: BoardTab[];
  activeTabId?: string;
  items?: BoardItem[];
  connections?: Connection[];
  annotations?: BoardAnnotation[];
};
