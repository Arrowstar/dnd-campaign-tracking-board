'use client';

import React, { useState, useEffect } from 'react';
import { BoardItem, ItemField, AttachedFile, FieldType, User } from '@/lib/types';
import { 
  FileText, 
  Image as ImageIcon, 
  Paperclip, 
  Plus, 
  Trash2, 
  Upload, 
  Link as LinkIcon, 
  Edit3, 
  Check, 
  ExternalLink,
  File,
  X,
  Tag,
  Sparkles,
  UserCheck
} from 'lucide-react';
import ImageDrawer from './ImageDrawer';
import { RichTextEditor, RichTextDisplay } from './RichTextEditor';
import { fileToCompressedDataURL, uploadFileToBlob } from '@/lib/utils';

interface NpcBoardItemFieldsProps {
  item: BoardItem;
  user: User;
  canEdit: boolean;
  isLight: boolean;
  onUpdate: (item: BoardItem) => void;
  /** All board items, passed for future cross-reference support in NPC fields. */
  allItems?: BoardItem[];
  onScrollToItem?: (id: string) => void;
}

export interface PersonalityTraitsObj {
  personality?: string;
  quirks?: string;
  goals?: string;
  alignment?: string;
  physical?: string;
  other?: string;
}

export function parsePersonalityTraits(textValue?: string): PersonalityTraitsObj {
  if (!textValue) return {};
  try {
    const parsed = JSON.parse(textValue);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    return { other: textValue };
  }
  return {};
}

export function stringifyPersonalityTraits(data: PersonalityTraitsObj): string {
  return JSON.stringify(data);
}

const FIELD_PLACEHOLDERS: Record<string, string> = {
  'Where Met / Location': 'e.g., Sleeping Giant Tavern, Phandalin. Encountered asking for help...',
  'History of Interactions': 'Log of key interactions, deals, or encounters with the party...',
  'Other Notes': 'Free-form notes, background lore, stats, secrets...'
};

export function getDefaultNpcFields(existingContent?: string): ItemField[] {
  return [
    {
      id: 'npc-image',
      label: 'Character Portrait',
      type: 'image',
      imageUrl: '',
      lines: []
    },
    {
      id: 'npc-personality-traits',
      label: 'Personality & Traits',
      type: 'text',
      textValue: stringifyPersonalityTraits({
        personality: '',
        quirks: '',
        goals: '',
        alignment: '',
        physical: '',
        other: ''
      })
    },
    {
      id: 'npc-location',
      label: 'Where Met / Location',
      type: 'text',
      textValue: ''
    },
    {
      id: 'npc-history',
      label: 'History of Interactions',
      type: 'text',
      textValue: ''
    },
    {
      id: 'npc-other',
      label: 'Other Notes',
      type: 'text',
      textValue: existingContent || ''
    },
    {
      id: 'npc-files',
      label: 'Associated Files & Links',
      type: 'file',
      files: []
    }
  ];
}

export default function NpcBoardItemFields({
  item,
  canEdit,
  isLight,
  onUpdate
}: NpcBoardItemFieldsProps) {
  // Migration logic to consolidate individual trait fields into Personality & Traits box
  useEffect(() => {
    if (!item.fields || item.fields.length === 0) {
      onUpdate({
        ...item,
        fields: getDefaultNpcFields(item.content)
      });
      return;
    }

    // Check if item has individual split fields from a previous schema version
    const hasSplitFields = item.fields.some(f => 
      ['npc-personality', 'npc-quirks', 'npc-goals', 'npc-alignment', 'npc-physical'].includes(f.id)
    );

    if (hasSplitFields) {
      const personalityVal = item.fields.find(f => f.id === 'npc-personality' || f.label === 'Personality')?.textValue || '';
      const quirksVal = item.fields.find(f => f.id === 'npc-quirks' || f.label === 'Quirks')?.textValue || '';
      const goalsVal = item.fields.find(f => f.id === 'npc-goals' || f.label === 'Goals')?.textValue || '';
      const alignmentVal = item.fields.find(f => f.id === 'npc-alignment' || f.label === 'Alignment')?.textValue || '';
      const physicalVal = item.fields.find(f => f.id === 'npc-physical' || f.label === 'Physical Traits')?.textValue || '';

      const traitsData: PersonalityTraitsObj = {
        personality: personalityVal,
        quirks: quirksVal,
        goals: goalsVal,
        alignment: alignmentVal,
        physical: physicalVal,
        other: ''
      };

      const nonSplitFields = item.fields.filter(f => 
        !['npc-personality', 'npc-quirks', 'npc-goals', 'npc-alignment', 'npc-physical'].includes(f.id) &&
        !['Personality', 'Quirks', 'Goals', 'Alignment', 'Physical Traits'].includes(f.label)
      );

      const combinedField: ItemField = {
        id: 'npc-personality-traits',
        label: 'Personality & Traits',
        type: 'text',
        textValue: stringifyPersonalityTraits(traitsData)
      };

      const imageIndex = nonSplitFields.findIndex(f => f.id === 'npc-image' || f.type === 'image');
      const insertIdx = imageIndex >= 0 ? imageIndex + 1 : 0;
      nonSplitFields.splice(insertIdx, 0, combinedField);

      onUpdate({
        ...item,
        fields: nonSplitFields
      });
      return;
    }

    // Handle plain text inside Personality & Traits
    const pAndTField = item.fields.find(f => f.id === 'npc-personality-traits' || f.label === 'Personality & Traits');
    if (pAndTField && pAndTField.textValue) {
      try {
        const parsed = JSON.parse(pAndTField.textValue);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Not JSON');
        }
      } catch {
        const updated = item.fields.map(f => {
          if (f.id === pAndTField.id) {
            return {
              ...f,
              textValue: stringifyPersonalityTraits({ other: pAndTField.textValue })
            };
          }
          return f;
        });
        onUpdate({ ...item, fields: updated });
      }
    }
  }, [item, onUpdate]);

  const fields: ItemField[] = item.fields && item.fields.length > 0 
    ? item.fields 
    : getDefaultNpcFields(item.content);

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingTraitKey, setEditingTraitKey] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState<string>('');
  
  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');

  // Input state for image/file links
  const [activeUrlInput, setActiveUrlInput] = useState<{ fieldId: string; type: 'image' | 'file'; text: string; fileName?: string } | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

  const updateFields = (newFields: ItemField[]) => {
    onUpdate({
      ...item,
      fields: newFields
    });
  };

  const handleUpdateField = (fieldId: string, updates: Partial<ItemField>) => {
    const nextFields = fields.map(f => f.id === fieldId ? { ...f, ...updates } : f);
    updateFields(nextFields);
  };

  const handleDeleteField = (fieldId: string) => {
    const nextFields = fields.filter(f => f.id !== fieldId);
    updateFields(nextFields);
  };

  const handleAddField = () => {
    if (!newFieldLabel.trim()) return;
    const newField: ItemField = {
      id: 'field-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      label: newFieldLabel.trim(),
      type: newFieldType,
      textValue: newFieldType === 'text' ? '' : undefined,
      imageUrl: newFieldType === 'image' ? '' : undefined,
      files: newFieldType === 'file' ? [] : undefined,
      lines: newFieldType === 'image' ? [] : undefined
    };
    updateFields([...fields, newField]);
    setNewFieldLabel('');
    setShowAddField(false);
  };

  const handleImageFileUpload = async (fieldId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFileToBlob(file);
      handleUpdateField(fieldId, { imageUrl: url });
    } catch (err) {
      console.error('Error uploading NPC image field:', err);
    }
    e.target.value = '';
  };

  const handleImageDrop = async (fieldId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingFieldId(null);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const url = await uploadFileToBlob(file);
        handleUpdateField(fieldId, { imageUrl: url });
      } catch (err) {
        console.error('Error uploading dropped NPC image field:', err);
      }
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('URL');
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) {
      handleUpdateField(fieldId, { imageUrl: url.trim() });
    }
  };

  const handleDocumentFileUpload = async (fieldId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const currentField = fields.find(f => f.id === fieldId);
    const existingAttached = currentField?.files || [];

    for (const file of Array.from(uploadedFiles)) {
      try {
        const url = await uploadFileToBlob(file);
        const newFile: AttachedFile = {
          id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          name: file.name,
          url,
          size: file.size,
          mimeType: file.type
        };
        handleUpdateField(fieldId, { files: [...existingAttached, newFile] });
      } catch (err) {
        console.error('Error uploading document file:', err);
      }
    }
    e.target.value = '';
  };

  const handleAddFileUrl = (fieldId: string, url: string, customName?: string) => {
    if (!url.trim()) return;
    const currentField = fields.find(f => f.id === fieldId);
    const existingAttached = currentField?.files || [];
    
    let derivedName = customName?.trim() || '';
    if (!derivedName) {
      try {
        const parsed = new URL(url);
        derivedName = parsed.pathname.split('/').pop() || parsed.hostname;
      } catch {
        derivedName = url.length > 30 ? url.slice(0, 30) + '...' : url;
      }
    }

    const newFile: AttachedFile = {
      id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      name: derivedName,
      url: url.trim(),
    };

    handleUpdateField(fieldId, { files: [...existingAttached, newFile] });
    setActiveUrlInput(null);
  };

  const handleRemoveFile = (fieldId: string, fileId: string) => {
    const currentField = fields.find(f => f.id === fieldId);
    if (!currentField) return;
    const updatedFiles = (currentField.files || []).filter(f => f.id !== fileId);
    handleUpdateField(fieldId, { files: updatedFiles });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFieldIcon = (type: FieldType, label: string) => {
    if (label === 'Personality & Traits') return <UserCheck size={14} className="text-[#B58D3D] flex-shrink-0" />;
    switch (type) {
      case 'image': return <ImageIcon size={13} className="text-amber-600 flex-shrink-0" />;
      case 'text': return <FileText size={13} className="text-blue-600 flex-shrink-0" />;
      case 'file': return <Paperclip size={13} className="text-emerald-600 flex-shrink-0" />;
    }
  };

  const renderPersonalityTraitsBox = (field: ItemField) => {
    const traits = parsePersonalityTraits(field.textValue);

    const handleTraitChange = (key: keyof PersonalityTraitsObj, val: string) => {
      const updated = { ...traits, [key]: val };
      handleUpdateField(field.id, { textValue: stringifyPersonalityTraits(updated) });
    };

    const traitItems: Array<{ key: keyof PersonalityTraitsObj; label: string; placeholder: string }> = [
      { key: 'personality', label: 'Personality', placeholder: '1-sentence max (e.g., Warm, humorous, fiercely loyal)...' },
      { key: 'quirks', label: 'Quirks', placeholder: '1-sentence max (e.g., Constantly taps fingers when nervous)...' },
      { key: 'goals', label: 'Goals', placeholder: '1-sentence max (e.g., Seeking revenge on the Redbrands)...' },
      { key: 'alignment', label: 'Alignment', placeholder: '1-sentence max (e.g., Neutral Good, Lawful Evil)...' },
      { key: 'physical', label: 'Physical Traits', placeholder: '1-sentence max (e.g., Scarred half-orc with gold tooth)...' }
    ];

    const stopImmediateEvent = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      if ('nativeEvent' in e && e.nativeEvent) {
        e.nativeEvent.stopImmediatePropagation?.();
      }
    };

    return (
      <div 
        className="flex flex-col gap-2.5 p-2.5"
        onPointerDown={stopImmediateEvent}
        onPointerDownCapture={stopImmediateEvent}
        onMouseDown={stopImmediateEvent}
        onMouseDownCapture={stopImmediateEvent}
      >
        {/* 5 Short Sentence Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {traitItems.map(({ key, label, placeholder }) => {
            const val = traits[key] || '';
            const isEditingThisTrait = editingTraitKey === key;

            return (
              <div 
                key={key} 
                className={`flex flex-col rounded p-2 border transition-all ${
                  isLight 
                    ? 'bg-[#F9F7F3] border-[#E2D9CB]' 
                    : 'bg-black/20 border-white/10'
                }`}
                data-interactive="true"
                onPointerDown={stopImmediateEvent}
                onPointerDownCapture={stopImmediateEvent}
                onMouseDown={stopImmediateEvent}
                onMouseDownCapture={stopImmediateEvent}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[11px] font-bold text-[#423D38] uppercase tracking-wider font-sans">
                    {label}
                  </span>
                  <span className="text-[8px] uppercase tracking-wider px-1 py-0.2 bg-[#B58D3D]/10 text-[#8C621E] border border-[#B58D3D]/20 rounded font-sans font-semibold">
                    1 sentence max
                  </span>
                </div>

                {isEditingThisTrait && canEdit ? (
                  <input
                    type="text"
                    autoFocus
                    value={val}
                    onChange={(e) => handleTraitChange(key, e.target.value)}
                    onBlur={() => setEditingTraitKey(null)}
                    placeholder={placeholder}
                    className="w-full text-xs py-1 px-2 bg-white border border-[#B58D3D] rounded outline-none text-[#2C2824] shadow-2xs font-sans transition-colors"
                    onPointerDown={stopImmediateEvent}
                    onPointerDownCapture={stopImmediateEvent}
                    onMouseDown={stopImmediateEvent}
                    onMouseDownCapture={stopImmediateEvent}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setEditingTraitKey(null);
                      }
                    }}
                  />
                ) : (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canEdit) setEditingTraitKey(key);
                    }}
                    className={`text-xs text-[#2C2824] min-h-[26px] py-1 px-1.5 rounded transition-colors font-sans flex items-center justify-between gap-1 ${
                      canEdit ? 'cursor-pointer hover:bg-black/5 group/trait' : ''
                    }`}
                    title={canEdit ? `Click to edit ${label.toLowerCase()}` : undefined}
                  >
                    {val ? (
                      <span className="font-medium text-[#2C2824]">{val}</span>
                    ) : (
                      <span className="text-[#8C7B6E]/60 italic text-[11px]">
                        {canEdit ? `Click to add ${label.toLowerCase()}...` : 'Not recorded'}
                      </span>
                    )}
                    {canEdit && (
                      <Edit3 size={10} className="opacity-0 group-hover/trait:opacity-60 text-[#8C7B6E] flex-shrink-0" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Larger Free-form Other Field Inside Personality Box */}
        <div 
          className={`flex flex-col rounded p-2.5 border transition-all mt-0.5 ${
            isLight 
              ? 'bg-[#F9F7F3] border-[#E2D9CB]' 
              : 'bg-black/20 border-white/10'
          }`}
          data-interactive="true"
          onPointerDown={stopImmediateEvent}
          onPointerDownCapture={stopImmediateEvent}
          onMouseDown={stopImmediateEvent}
          onMouseDownCapture={stopImmediateEvent}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[11px] font-bold text-[#423D38] uppercase tracking-wider font-sans flex items-center gap-1">
              <Sparkles size={11} className="text-[#B58D3D]" />
              <span>Other Traits & Details</span>
            </span>
            <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.2 bg-blue-500/10 text-blue-700 border border-blue-500/20 rounded font-sans font-semibold">
              Free-form
            </span>
          </div>

          {editingTraitKey === 'other' && canEdit ? (
            <div 
              className="flex flex-col gap-1.5"
              onPointerDown={stopImmediateEvent}
              onPointerDownCapture={stopImmediateEvent}
              onMouseDown={stopImmediateEvent}
              onMouseDownCapture={stopImmediateEvent}
              onClick={(e) => e.stopPropagation()}
            >
              <RichTextEditor
                value={traits.other || ''}
                onChange={(val) => handleTraitChange('other', val)}
                placeholder="Additional personality details, background notes, habits, secrets..."
                isLight={isLight}
                compact={false}
                className="w-full"
              />
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onPointerDown={stopImmediateEvent}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTraitKey(null);
                  }}
                  className="px-2.5 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                >
                  <Check size={11} />
                  <span>Done</span>
                </button>
              </div>
            </div>
          ) : (
            <div 
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit) setEditingTraitKey('other');
              }}
              className={`min-h-[36px] p-2 rounded transition-all font-sans text-xs relative ${
                canEdit ? 'cursor-pointer hover:bg-black/5 hover:border hover:border-[#D9D0C1] group/other' : ''
              }`}
              title={canEdit ? 'Click to edit additional traits & details' : undefined}
            >
              {traits.other ? (
                <RichTextDisplay content={traits.other} />
              ) : (
                <span className="text-[#8C7B6E]/60 italic flex items-center gap-1 py-1">
                  <Edit3 size={11} className="opacity-70" />
                  <span>
                    {canEdit 
                      ? 'Add additional personality traits or background details...' 
                      : 'No additional traits recorded'}
                  </span>
                </span>
              )}
              {canEdit && traits.other && (
                <div className="absolute top-1 right-1 opacity-0 group-hover/other:opacity-100 transition-opacity bg-white/95 border border-[#D9D0C1] rounded px-1.5 py-0.5 text-[10px] text-[#423D38] flex items-center gap-1 shadow-xs pointer-events-none">
                  <Edit3 size={10} />
                  <span>Edit</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div 
      className="flex flex-col gap-3 font-sans w-full"
      onPointerDown={(e) => {
        // Prevent card drag if clicking inside any field
        e.stopPropagation();
      }}
    >
      {fields.map((field) => {
        const isPersonalityBox = field.id === 'npc-personality-traits' || field.label === 'Personality & Traits';

        return (
          <div 
            key={field.id}
            className={`flex flex-col rounded-md border transition-all ${
              isLight 
                ? 'bg-white/80 border-[#D9D0C1] shadow-xs' 
                : 'bg-black/10 border-black/20'
            }`}
          >
            {/* Field Label Header */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#F5F2ED] border-b border-[#D9D0C1]/70 rounded-t-md text-xs font-bold text-[#423D38]">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {getFieldIcon(field.type, field.label)}
                {editingLabelId === field.id ? (
                  <div className="flex items-center gap-1 flex-1 min-w-0" data-interactive="true">
                    <input
                      type="text"
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      className="px-1 py-0.5 text-xs font-bold text-[#2C2824] bg-white border border-[#B58D3D] rounded outline-none w-full"
                      autoFocus
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateField(field.id, { label: labelInput.trim() || field.label });
                          setEditingLabelId(null);
                        } else if (e.key === 'Escape') {
                          setEditingLabelId(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateField(field.id, { label: labelInput.trim() || field.label });
                        setEditingLabelId(null);
                      }}
                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                      title="Save Label"
                    >
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-serif italic text-sm text-[#2C2824]">{field.label}</span>
                    {isPersonalityBox && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 bg-[#B58D3D]/15 text-[#8C621E] border border-[#B58D3D]/30 rounded font-sans font-semibold flex-shrink-0">
                        Encapsulated Traits
                      </span>
                    )}
                    {field.label === 'Where Met / Location' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 bg-blue-500/10 text-blue-700 border border-blue-500/20 rounded font-sans font-semibold flex-shrink-0">
                        Free-form
                      </span>
                    )}
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex items-center gap-1 flex-shrink-0 ml-1" data-interactive="true">
                  {field.type === 'text' && !isPersonalityBox && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFieldId(editingFieldId === field.id ? null : field.id);
                      }}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors ${
                        editingFieldId === field.id
                          ? 'bg-[#2C2824] text-white shadow-xs'
                          : 'bg-white hover:bg-[#EBE4D8] text-[#423D38] border border-[#D9D0C1]'
                      }`}
                      title={editingFieldId === field.id ? 'Close Editor' : 'Edit Content'}
                    >
                      <Edit3 size={11} />
                      <span>{editingFieldId === field.id ? 'Done' : 'Edit'}</span>
                    </button>
                  )}

                  {editingLabelId !== field.id && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingLabelId(field.id);
                        setLabelInput(field.label);
                      }}
                      className="p-1 text-[#8C7B6E] hover:text-[#2C2824] hover:bg-black/5 rounded transition-colors cursor-pointer"
                      title="Rename Field Label"
                    >
                      <Tag size={11} />
                    </button>
                  )}

                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete the "${field.label}" field?`)) {
                        handleDeleteField(field.id);
                      }
                    }}
                    className="p-1 text-[#8C7B6E] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                    title="Delete Field"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>

            {/* Field Body by Type */}
            {isPersonalityBox ? (
              renderPersonalityTraitsBox(field)
            ) : (
              <div className="p-2.5">
                {/* TYPE: TEXT */}
                {field.type === 'text' && (
                  <div>
                    {editingFieldId === field.id && canEdit ? (
                      <div className="flex flex-col gap-1.5" data-interactive="true">
                        <RichTextEditor
                          value={field.textValue || ''}
                          onChange={(val) => handleUpdateField(field.id, { textValue: val })}
                          placeholder={FIELD_PLACEHOLDERS[field.label] || `Enter ${field.label.toLowerCase()}...`}
                          isLight={isLight}
                          compact={false}
                          className="w-full"
                        />
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingFieldId(null);
                            }}
                            className="px-2.5 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                          >
                            <Check size={11} />
                            <span>Done Editing</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        data-interactive="true"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canEdit) setEditingFieldId(field.id);
                        }}
                        className="min-h-[36px] p-2 rounded border border-transparent hover:border-[#D9D0C1] hover:bg-black/5 transition-all cursor-text group relative font-sans text-xs"
                        title={canEdit ? `Click to edit ${field.label.toLowerCase()}` : undefined}
                      >
                        {field.textValue ? (
                          <RichTextDisplay content={field.textValue} />
                        ) : (
                          <span className="text-[#8C7B6E]/60 italic flex items-center gap-1 py-1">
                            <Edit3 size={11} className="opacity-70" />
                            <span>Add {field.label.toLowerCase()}...</span>
                          </span>
                        )}
                        {canEdit && (
                          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 border border-[#D9D0C1] rounded px-1.5 py-0.5 text-[10px] text-[#423D38] flex items-center gap-1 shadow-xs pointer-events-none">
                            <Edit3 size={10} />
                            <span>Edit</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TYPE: IMAGE */}
                {field.type === 'image' && (() => {
                  const isDragging = draggingFieldId === field.id;
                  return (
                    <div
                      className={`flex flex-col gap-2 p-2.5 transition-all duration-200 rounded-lg ${
                        isDragging ? 'bg-amber-500/10 ring-2 ring-[#B58D3D] border-[#B58D3D]' : ''
                      }`}
                      data-interactive="true"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (canEdit && draggingFieldId !== field.id) setDraggingFieldId(field.id);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (draggingFieldId === field.id) setDraggingFieldId(null);
                      }}
                      onDrop={(e) => {
                        if (canEdit) handleImageDrop(field.id, e);
                      }}
                    >
                      {field.imageUrl ? (
                        <div className="flex flex-col gap-2 relative">
                          <div className={`rounded border border-[#D9D0C1] overflow-hidden bg-black/5 relative transition-all ${
                            isDragging ? 'border-[#B58D3D] shadow-md' : ''
                          }`}>
                            <ImageDrawer
                              imageUrl={field.imageUrl}
                              lines={field.lines || []}
                              onLinesChange={(lines) => handleUpdateField(field.id, { lines })}
                              canEdit={canEdit}
                            />
                            {isDragging && (
                              <div className="absolute inset-0 bg-[#2C2824]/75 backdrop-blur-xs flex items-center justify-center pointer-events-none z-20">
                                <span className="text-white font-bold text-xs bg-[#B58D3D] px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 animate-pulse">
                                  <Upload size={14} /> Drop image to replace
                                </span>
                              </div>
                            )}
                          </div>
                          {canEdit && (
                            <div className="flex items-center justify-between gap-1 text-[10px] text-[#8C7B6E]">
                              <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateField(field.id, { imageUrl: '' });
                                }}
                                className="text-red-600 hover:text-red-700 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <X size={10} />
                                <span>Remove Image</span>
                              </button>
                              <label 
                                onPointerDown={(e) => e.stopPropagation()}
                                className="text-[#2C2824] hover:text-[#B58D3D] font-bold cursor-pointer flex items-center gap-1"
                              >
                                <Upload size={10} />
                                <span>Replace File</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleImageFileUpload(field.id, e)}
                                  className="hidden"
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className={`border-2 border-dashed rounded-md p-3 text-center bg-black/5 flex flex-col items-center justify-center gap-2 text-[#8C7B6E] transition-all ${
                            isDragging ? 'border-[#B58D3D] bg-amber-500/10 scale-[1.01]' : 'border-[#D9D0C1]'
                          }`}>
                            <ImageIcon size={24} className={`opacity-50 transition-colors ${isDragging ? 'text-[#B58D3D] scale-110' : 'text-[#B58D3D]'}`} />
                            <span className="text-xs font-semibold">
                              {isDragging ? 'Drop image file here' : 'No character portrait added'}
                            </span>
                            {canEdit && (
                              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                                <label 
                                  onPointerDown={(e) => e.stopPropagation()}
                                  className="px-3 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-xs font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                >
                                  <Upload size={12} />
                                  <span>Upload Image File</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleImageFileUpload(field.id, e)}
                                    className="hidden"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveUrlInput({ fieldId: field.id, type: 'image', text: '' });
                                  }}
                                  className="px-3 py-1 bg-white hover:bg-[#F5F2ED] text-[#423D38] border border-[#D9D0C1] text-xs font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                >
                                  <LinkIcon size={12} />
                                  <span>Link Image URL</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* TYPE: FILE */}
                {field.type === 'file' && (
                  <div className="flex flex-col gap-2" data-interactive="true">
                    {(!field.files || field.files.length === 0) ? (
                      <div className="text-center py-2 px-3 border border-dashed border-[#D9D0C1] rounded bg-black/5 text-[#8C7B6E] text-xs">
                        No files or links attached yet.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {field.files.map((file) => (
                          <div
                            key={file.id}
                            className="flex items-center justify-between p-2 bg-white border border-[#D9D0C1] rounded hover:border-[#B58D3D] transition-colors gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <File size={14} className="text-[#B58D3D] flex-shrink-0" />
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="font-bold text-[#2C2824] truncate" title={file.name}>
                                  {file.name}
                                </span>
                                {file.size && (
                                  <span className="text-[10px] text-[#8C7B6E]">
                                    {formatFileSize(file.size)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={file.name}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 text-[#423D38] hover:text-[#B58D3D] hover:bg-[#F5F2ED] rounded transition-colors"
                                title="Open or Download File"
                              >
                                <ExternalLink size={13} />
                              </a>
                              {canEdit && (
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveFile(field.id, file.id);
                                  }}
                                  className="p-1 text-[#8C7B6E] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                  title="Delete File"
                                >
                                  <X size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#F5F2ED]">
                        <label 
                          onPointerDown={(e) => e.stopPropagation()}
                          className="px-2.5 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                        >
                          <Upload size={11} />
                          <span>Upload Local File</span>
                          <input
                            type="file"
                            multiple
                            onChange={(e) => handleDocumentFileUpload(field.id, e)}
                            className="hidden"
                          />
                        </label>

                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveUrlInput({ fieldId: field.id, type: 'file', text: '', fileName: '' });
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-[#F5F2ED] text-[#423D38] border border-[#D9D0C1] text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                        >
                          <LinkIcon size={11} />
                          <span>Add Web File Link</span>
                        </button>
                      </div>
                    )}

                    {/* Add File Link Modal Input */}
                    {activeUrlInput?.fieldId === field.id && activeUrlInput.type === 'file' && (
                      <div className="p-2.5 bg-[#F5F2ED] border border-[#D9D0C1] rounded flex flex-col gap-2 mt-1" data-interactive="true">
                        <span className="text-[10px] font-bold uppercase text-[#8C7B6E]">Link External Document or Web Resource</span>
                        <input
                          type="text"
                          value={activeUrlInput.fileName || ''}
                          onChange={(e) => setActiveUrlInput({ ...activeUrlInput, fileName: e.target.value })}
                          placeholder="Display Name (e.g., Character Sheet PDF)"
                          className="px-2 py-1 text-xs bg-white border border-[#D9D0C1] rounded outline-none"
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                        <input
                          type="url"
                          value={activeUrlInput.text}
                          onChange={(e) => setActiveUrlInput({ ...activeUrlInput, text: e.target.value })}
                          placeholder="URL (e.g., https://example.com/sheet.pdf)"
                          className="px-2 py-1 text-xs bg-white border border-[#D9D0C1] rounded outline-none"
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveUrlInput(null);
                            }}
                            className="px-2 py-0.5 text-xs text-[#8C7B6E] hover:text-[#2C2824]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddFileUrl(field.id, activeUrlInput.text, activeUrlInput.fileName);
                            }}
                            className="px-2.5 py-1 bg-[#2C2824] text-white text-xs font-bold rounded cursor-pointer"
                          >
                            Add Link
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add Custom Field Section */}
      {canEdit && (
        <div className="pt-1" data-interactive="true">
          {!showAddField ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowAddField(true);
              }}
              className="w-full py-1.5 px-3 bg-[#F5F2ED] hover:bg-[#EBE4D8] border border-dashed border-[#B58D3D]/60 hover:border-[#B58D3D] text-[#B58D3D] text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={13} />
              <span>Add Custom Field to NPC</span>
            </button>
          ) : (
            <div className="p-3 bg-white border border-[#B58D3D] rounded-md shadow-md flex flex-col gap-2.5" data-interactive="true">
              <div className="flex items-center justify-between border-b pb-1 border-[#F5F2ED]">
                <span className="text-xs font-bold text-[#2C2824] uppercase tracking-wider">
                  Create New Field
                </span>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAddField(false);
                  }}
                  className="text-[#8C7B6E] hover:text-[#2C2824] cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#8C7B6E] uppercase">Field Name</label>
                <input
                  type="text"
                  placeholder="e.g. Secret Motivation, Voice Notes, Stat Block..."
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  className="px-2 py-1 text-xs bg-[#F5F2ED] border border-[#D9D0C1] rounded outline-none text-[#2C2824]"
                  autoFocus
                  onPointerDown={(e) => e.stopPropagation()}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#8C7B6E] uppercase">Field Type</label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewFieldType('text');
                    }}
                    className={`p-2 rounded border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      newFieldType === 'text'
                        ? 'bg-[#2C2824] text-white border-[#2C2824]'
                        : 'bg-[#F5F2ED] text-[#423D38] border-[#D9D0C1]'
                    }`}
                  >
                    <FileText size={14} className={newFieldType === 'text' ? 'text-blue-400' : 'text-blue-600'} />
                    <span>Formatted Text</span>
                  </button>

                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewFieldType('image');
                    }}
                    className={`p-2 rounded border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      newFieldType === 'image'
                        ? 'bg-[#2C2824] text-white border-[#2C2824]'
                        : 'bg-[#F5F2ED] text-[#423D38] border-[#D9D0C1]'
                    }`}
                  >
                    <ImageIcon size={14} className={newFieldType === 'image' ? 'text-amber-400' : 'text-amber-600'} />
                    <span>Image</span>
                  </button>

                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewFieldType('file');
                    }}
                    className={`p-2 rounded border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      newFieldType === 'file'
                        ? 'bg-[#2C2824] text-white border-[#2C2824]'
                        : 'bg-[#F5F2ED] text-[#423D38] border-[#D9D0C1]'
                    }`}
                  >
                    <Paperclip size={14} className={newFieldType === 'file' ? 'text-emerald-400' : 'text-emerald-600'} />
                    <span>File / Links</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAddField(false);
                  }}
                  className="px-3 py-1 text-xs text-[#8C7B6E] hover:text-[#2C2824] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddField();
                  }}
                  disabled={!newFieldLabel.trim()}
                  className="px-3 py-1 bg-[#2C2824] hover:bg-[#423D38] disabled:bg-[#D9D0C1] text-white text-xs font-bold rounded transition-colors cursor-pointer"
                >
                  Add Field
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
