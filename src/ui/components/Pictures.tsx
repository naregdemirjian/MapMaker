// Pictures kept with notes (Stage 4: "rich notes and images"): for a country, faction, character or
// city, an area, line or point, or an event. Stored in the project's pictures folder (as fills are);
// shown as thumbnails, opened large with a click.
import { useState } from 'react';
import { useStore } from '../store.ts';
import { Api } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { assetUrl } from '../../render-engine/assets.ts';

export function PicturesSection({ holder }: { holder: cmd.PictureHolder }) {
  const s = useStore();
  const [big, setBig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = cmd.picturesOf(s.world!, holder);
  const add = async (files: FileList | null) => {
    if (!files?.length || !s.projectId) return;
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) { s.toast(`${file.name} is not a picture.`, 'error'); continue; }
        added.push((await Api.uploadAsset(s.projectId, file)).file);
      }
      if (added.length) s.execute((w) => cmd.setPictures(w, holder, [...cmd.picturesOf(w, holder), ...added]));
    } catch (e) {
      s.toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pictures" data-testid="pictures">
      {list.length > 0 && (
        <div className="picture-grid">
          {list.map((f, i) => (
            <div key={`${f}-${i}`} className="picture">
              <img src={assetUrl(f)} alt="" onClick={() => setBig(f)} data-testid="picture-thumb" />
              <button className="small danger" title="Remove this picture" onClick={() => s.execute((w) => cmd.setPictures(w, holder, list.filter((_, j) => j !== i)))}>×</button>
            </div>
          ))}
        </div>
      )}
      <label className="file-button small">{busy ? 'Adding…' : 'Add pictures…'}<input type="file" accept="image/*" multiple onChange={(ev) => { void add(ev.target.files); ev.target.value = ''; }} data-testid="picture-upload" /></label>
      {big && (
        <div className="modal-back" onPointerDown={() => setBig(null)}>
          <img className="picture-large" src={assetUrl(big)} alt="" />
        </div>
      )}
    </div>
  );
}
