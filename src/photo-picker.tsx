// Choosing a profile picture: pick one from the phone's gallery, then move
// and zoom it inside a circle. The result is a small square JPEG (about
// 15 KB) as a data URL, the same on every phone.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, fonts, radius, space } from './theme';
import { Button } from './ui';

/** Size of the saved picture, in pixels. Enough for the largest avatar on a sharp screen. */
const OUT = 192;
const MAX_ZOOM = 4;

export const canPickPhoto = Platform.OS === 'web' && typeof document !== 'undefined';

/**
 * Open the phone's picker for a picture (gallery, camera or files). Call it
 * straight from a tap. Resolves with an address for the picked file, or null.
 */
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!canPickPhoto) return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? URL.createObjectURL(file) : null);
    };
    // Closing the picker without choosing: some browsers say so, others don't.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

interface Loaded {
  el: HTMLImageElement;
  w: number;
  h: number;
}
interface View3 {
  z: number; // zoom: 1 = the photo just covers the circle
  x: number; // where the photo's top-left corner sits in the circle
  y: number;
}

type Point = { pageX: number; pageY: number };
const touchesOf = (e: GestureResponderEvent) => (e.nativeEvent.touches ?? []) as unknown as Point[];
const distance = (t: Point[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

/** Keep the photo covering the circle: no gaps at the edges. */
function fitted(img: Loaded | null, frame: number, z: number, x: number, y: number): View3 {
  if (!img) return { z, x, y };
  const base = frame / Math.min(img.w, img.h);
  const w = img.w * base * z;
  const h = img.h * base * z;
  return { z, x: Math.min(0, Math.max(frame - w, x)), y: Math.min(0, Math.max(frame - h, y)) };
}

/** Zoom, keeping the middle of the circle on the same spot of the photo. */
function zoomed(img: Loaded | null, frame: number, from: View3, z: number): View3 {
  const nz = Math.max(1, Math.min(MAX_ZOOM, z));
  const r = nz / from.z;
  return fitted(img, frame, nz, frame / 2 - (frame / 2 - from.x) * r, frame / 2 - (frame / 2 - from.y) * r);
}

/** The cropped picture as a JPEG data URL, kept under the server's size limit. */
export function renderPhoto(img: Loaded, frame: number, v: View3): string {
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colors.raised; // behind transparent pictures
  ctx.fillRect(0, 0, OUT, OUT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scale = (frame / Math.min(img.w, img.h)) * v.z; // screen pixels per photo pixel
  ctx.drawImage(img.el, -v.x / scale, -v.y / scale, frame / scale, frame / scale, 0, 0, OUT, OUT);
  let quality = 0.86;
  let data = canvas.toDataURL('image/jpeg', quality);
  while (data.length > 56000 && quality > 0.4) {
    quality -= 0.15;
    data = canvas.toDataURL('image/jpeg', quality);
  }
  return data;
}

/**
 * Move and zoom the picked picture inside a circle, then save. `src` is the
 * picked file's address (null hides it).
 */
export function PhotoFramer({
  src,
  onCancel,
  onSave,
}: {
  src: string | null;
  onCancel: () => void;
  onSave: (image: string) => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const frame = Math.max(160, Math.min(280, width - 96));
  const [img, setImg] = useState<Loaded | null>(null);
  const [view, setView] = useState<View3>({ z: 1, x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!src) return;
    const el = new window.Image();
    el.onload = () => {
      const w = el.naturalWidth;
      const h = el.naturalHeight;
      const base = frame / Math.min(w, h);
      setImg({ el, w, h });
      // Start centred, a little above the middle on tall photos (faces sit high).
      setView({ z: 1, x: (frame - w * base) / 2, y: Math.min(0, Math.max(frame - h * base, (frame - h * base) * 0.35)) });
    };
    el.onerror = () => setError('This phone can’t open that picture. Try another one.');
    el.src = src;
    return () => URL.revokeObjectURL(src);
    // The frame size only matters for the starting position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Dragging and pinching, in screen pixels from where the touch began.
  const gesture = useRef({ start: view, x0: 0, y0: 0, pinchFrom: 0 });
  const begin = (e: GestureResponderEvent) => {
    const t = touchesOf(e);
    const p = t[0] ?? e.nativeEvent;
    gesture.current = { start: view, x0: p.pageX, y0: p.pageY, pinchFrom: t.length >= 2 ? distance(t) : 0 };
  };
  const move = (e: GestureResponderEvent) => {
    const g = gesture.current;
    const t = touchesOf(e);
    if (t.length >= 2) {
      // Two fingers: zoom.
      const d = distance(t);
      if (!g.pinchFrom) {
        g.pinchFrom = d;
        g.start = view;
        return;
      }
      setView(zoomed(img, frame, g.start, g.start.z * (d / g.pinchFrom)));
      return;
    }
    const p = t[0] ?? e.nativeEvent;
    if (g.pinchFrom) {
      // Lifted a finger after zooming: carry on moving from here.
      gesture.current = { start: view, x0: p.pageX, y0: p.pageY, pinchFrom: 0 };
      return;
    }
    setView(fitted(img, frame, g.start.z, g.start.x + p.pageX - g.x0, g.start.y + p.pageY - g.y0));
  };

  const base = img ? frame / Math.min(img.w, img.h) : 1;
  const save = async () => {
    if (!img) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(renderPhoto(img, frame, view));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the picture. Try again.');
    }
    setSaving(false);
  };

  return (
    <Modal visible={!!src} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Your picture</Text>
          <View
            style={[s.frame, { width: frame, height: frame, borderRadius: frame / 2 }, web({ touchAction: 'none', cursor: 'grab' })]}
            accessibilityLabel="Drag to move the picture"
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={begin}
            onResponderMove={move}
          >
            {img && src ? (
              // The circle takes the touches; the picture just follows.
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Image
                  source={{ uri: src }}
                  style={{
                    position: 'absolute',
                    left: view.x,
                    top: view.y,
                    width: img.w * base * view.z,
                    height: img.h * base * view.z,
                  }}
                />
              </View>
            ) : error ? null : (
              <ActivityIndicator color={colors.star} />
            )}
          </View>
          {canPickPhoto ? (
            <View style={s.zoomRow}>
              <Text style={s.zoomMark}>−</Text>
              {React.createElement('input', {
                type: 'range',
                min: 1,
                max: MAX_ZOOM,
                step: 0.01,
                value: view.z,
                'aria-label': 'Zoom',
                disabled: !img,
                onChange: (e: { target: { value: string } }) => setView(zoomed(img, frame, view, Number(e.target.value))),
                style: { flex: 1, accentColor: colors.star, height: 28, margin: 0 },
              })}
              <Text style={s.zoomMark}>+</Text>
            </View>
          ) : null}
          <Text style={error ? s.error : s.hint}>{error ?? 'Drag to move. Pinch or slide to zoom.'}</Text>
          <View style={s.actions}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={saving ? 'Saving…' : 'Use picture'} onPress={save} disabled={!img || saving} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Styles that only mean something in a browser. */
function web(style: Record<string, string>): object {
  return Platform.OS === 'web' ? style : {};
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3, 4, 14, 0.75)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.lg,
    alignItems: 'center',
  },
  title: { fontFamily: fonts.medium, fontSize: 16, color: colors.text, marginBottom: space.md, alignSelf: 'flex-start' },
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.raised,
    borderWidth: 2,
    borderColor: colors.star,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'stretch', marginTop: space.md },
  zoomMark: { fontSize: 18, color: colors.muted, width: 16, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.muted, marginTop: space.sm, textAlign: 'center' },
  error: { fontSize: 13, color: colors.owe, marginTop: space.sm, textAlign: 'center', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch', marginTop: space.lg },
});
