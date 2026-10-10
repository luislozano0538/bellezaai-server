(() => {
  const home=document.querySelector("#home");
  const settings=document.querySelector("#settings .pagebar");
  const app=document.querySelector(".app");
  if (!home || !settings || !app) return;

  const style=document.createElement("style");
  style.textContent=`
    .gallery-entry{display:block;width:100%;margin:12px 0;text-align:left;background:#161616;color:#d7b77c;border:1px solid #9d7e4c;border-radius:16px;padding:13px 16px;font-weight:800;cursor:pointer}
    .gallery-cover{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 14px}
    .gallery-cover img{display:block;width:100%;height:110px;object-fit:cover;border-radius:12px}
    #galleryModal .sheet{background:#151515;color:#f8f1e5;border-top:2px solid #b99b61}
    #galleryModal .close{background:#2b2825;color:#fff}
    #galleryModal .form label,#galleryModal .small{color:#e6d6bd}
    #galleryModal .form input{background:#252525;color:#fff;border-color:#695634}
    #galleryModal .primary{background:linear-gradient(135deg,#8c6a37,#c8a873);color:#111}
    .gallery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}
    .gallery-tile{background:#24211c;border:1px solid #665333;border-radius:15px;overflow:hidden}
    .gallery-tile img{display:block;width:100%;height:145px;object-fit:cover}
    .gallery-tile p{padding:6px 10px;margin:0;font-size:13px;overflow-wrap:anywhere}
    .gallery-remove{margin:0 8px 8px;padding:8px 10px;border-radius:10px;background:#332927;border:1px solid #9d7e4c;color:#f4dfb9;cursor:pointer}
  `;
  document.head.append(style);

  const entry=document.createElement("button");
  entry.type="button";entry.className="gallery-entry";
  entry.textContent="📷 Galería de trabajos · Añadir fotos";
  home.prepend(entry);
  const settingsEntry=entry.cloneNode(true);
  settings.after(settingsEntry);

  const preview=document.createElement("div");
  preview.className="gallery-cover";preview.hidden=true;
  entry.after(preview);

  const modal=document.createElement("div");modal.className="modal";modal.id="galleryModal";
  modal.innerHTML=`
   <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="galleryTitle">
    <div class="sheetbar"><h2 id="galleryTitle">Galería de trabajos</h2><button type="button" class="close" aria-label="Cerrar">×</button></div>
    <p class="small">Muestra uñas, cabello, pestañas y otros trabajos reales del salón. Hasta 18 fotografías.</p>
    <p id="galleryStatus" role="status"></p>
    <div id="galleryGrid" class="gallery-grid"></div>
    <form id="galleryForm" class="form">
     <label for="galleryFile">Añadir foto desde tu teléfono
       <input id="galleryFile" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label>
     <label for="galleryCaption">Descripción (opcional)
       <input id="galleryCaption" name="caption" type="text" maxlength="120" placeholder="Ej.: Balayage dorado"></label>
     <button class="primary" type="submit">Guardar fotografía</button>
    </form>
   </div>`;
  app.append(modal);
  const grid=modal.querySelector("#galleryGrid");
  const status=modal.querySelector("#galleryStatus");
  const form=modal.querySelector("#galleryForm");
  let busy=false,photos=[],owner=false,version=0;

  async function api(path,method="GET",body) {
    const token=localStorage.getItem("bellezaAIToken");
    if (!token) throw Error("Inicia sesión para ver o editar la galería.");
    const response=await fetch(path,{method,cache:"no-store",headers:{
      Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})
    },...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if (token!==localStorage.getItem("bellezaAIToken")) throw Error("La sesión cambió. Abre la galería de nuevo.");
    if (!response.ok) throw Error(result.error||"No se pudo completar la solicitud.");
    return result;
  }
  async function compress(file) {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size>10*1024*1024)
      throw Error("Usa JPG, PNG o WebP de hasta 10 MB.");
    const url=URL.createObjectURL(file);
    try {
      const img=new Image();img.src=url;await img.decode();
      const ratio=Math.min(1,900/Math.max(img.naturalHeight,img.naturalWidth));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
      const ctx=canvas.getContext("2d");
      if (!ctx) throw Error("No se pudo preparar la foto.");
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      for (const quality of [0.82,0.68,0.52,0.35]) {
        const data=canvas.toDataURL("image/jpeg",quality);
        if (data.length<=220000) return data;
      }
      throw Error("Foto demasiado grande. Usa una imagen más pequeña.");
    } finally { URL.revokeObjectURL(url); }
  }
  function render() {
    grid.replaceChildren();preview.replaceChildren();
    const cover=photos.slice(0,3);
    preview.hidden=!cover.length;
    cover.forEach(item=>{
      const img=document.createElement("img");img.src=item.imageData;img.alt=item.caption||"Trabajo del salón";preview.append(img);
    });
    if (!photos.length) {
      const empty=document.createElement("p");empty.textContent="Todavía no hay fotos. Añade el primer trabajo.";
      grid.append(empty);
    }
    photos.forEach(item=>{
      const tile=document.createElement("div");tile.className="gallery-tile";
      const img=document.createElement("img");img.src=item.imageData;img.alt=item.caption||"Trabajo del salón";img.loading="lazy";
      const caption=document.createElement("p");caption.textContent=item.caption||"Trabajo del salón";
      tile.append(img,caption);
      if (owner) {
        const remove=document.createElement("button");remove.type="button";remove.className="gallery-remove";
        remove.textContent="Quitar";remove.disabled=busy;
        remove.onclick=async ()=>{
          if (busy || !confirm("¿Quitar esta foto de la galería pública?")) return;
          busy=true;remove.disabled=true;status.textContent="Quitando foto…";
          try {
            await api("/api/salon/gallery/"+encodeURIComponent(item.id),"DELETE");
            photos=photos.filter(x=>x.id!==item.id);render();status.textContent="Foto quitada.";
          } catch(error){status.textContent=error.message;} finally{busy=false;}
        };
        tile.append(remove);
      }
      grid.append(tile);
    });
    form.hidden=!owner || photos.length>=18;
    if (owner && photos.length>=18) status.textContent="Límite de 18 fotos. Quita alguna para añadir otra.";
  }
  async function load(showModal=false) {
    const current=++version;
    if(showModal){openModal("galleryModal");status.textContent="Cargando fotos…";}
    try {
      const [gallery,profile]=await Promise.all([
        api("/api/salon/gallery"),api("/api/profile")
      ]);
      if(current!==version)return;
      photos=gallery.photos||[];owner=profile.role==="owner";
      render();if(showModal)status.textContent=photos.length+" de 18 fotos guardadas.";
    }catch(error){if(showModal && current===version) status.textContent=error.message;}
  }
  async function open(){if (busy)return;form.reset();await load(true);}
  entry.onclick=settingsEntry.onclick=open;
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy||!owner)return;
    const file=modal.querySelector("#galleryFile").files[0];
    if(!file)return;
    busy=true;form.querySelector("button[type=submit]").disabled=true;
    status.textContent="Preparando y guardando foto…";
    try {
      const imageData=await compress(file);
      const caption=modal.querySelector("#galleryCaption").value.trim();
      const result=await api("/api/salon/gallery","POST",{imageData,caption});
      photos.unshift(result.photo);form.reset();render();status.textContent="Foto guardada y disponible en la página de reservas.";
    }catch(error){status.textContent=error.message;}
    finally{busy=false;form.querySelector("button[type=submit]").disabled=false;}
  });
  modal.querySelector(".close").onclick=()=>{if(!busy){version++;closeModal("galleryModal");}};
  modal.onclick=event=>{if(event.target===modal && !busy){version++;closeModal("galleryModal");}};
  if(localStorage.getItem("bellezaAIToken"))load(false);
  window.addEventListener("account-signed-in",()=>load(false));
})();
