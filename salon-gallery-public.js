(() => {
  const profile=document.getElementById("salonProfile");
  if (!profile) return;
  const salonId=location.pathname.split("/").filter(Boolean).pop();
  if (!/^[0-9a-f-]{36}$/i.test(salonId)) return;

  const section=document.createElement("section");
  section.id="publicGallery";
  section.className="card";
  section.hidden=true;
  section.style.cssText="background:#171717;color:#f6eddc;border:1px solid #ad905e";
  const heading=document.createElement("h2");
  heading.textContent="Nuestros trabajos";
  heading.style.color="#d5b77c";
  const subtitle=document.createElement("p");
  subtitle.textContent="Descubre algunos de los trabajos realizados en nuestro salón.";
  subtitle.style.color="#e0d2bc";
  const grid=document.createElement("div");
  grid.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px";
  const filter=document.createElement("select");
  filter.setAttribute("aria-label","Filtrar trabajos por servicio");
  filter.style.cssText="display:block;width:100%;margin:14px 0 16px;padding:12px;background:#27221d;color:#f8e8cb;border:1px solid #ad905e;border-radius:12px;font-size:16px";
  for (const name of ["Todos","Uñas","Cabello","Pestañas","Cejas","Depilación","Otros"]) {
    const option=document.createElement("option");option.value=name;option.textContent=name;filter.append(option);
  }
  filter.onchange=()=>{
    grid.querySelectorAll("figure").forEach(figure=>{
      figure.hidden=filter.value!=="Todos"&&figure.dataset.category!==filter.value;
    });
  };
  section.append(heading,subtitle,filter,grid);
  profile.after(section);

  fetch("/api/public/salons/"+encodeURIComponent(salonId)+"/gallery",{cache:"no-store"})
    .then(response=>{if(!response.ok)throw Error("Not public");return response.json();})
    .then(data=>{
      const photos=Array.isArray(data.photos)?data.photos:[];
      photos.forEach(photo=>{
        if(typeof photo.imageUrl!=="string" || !photo.imageUrl.startsWith("/api/public/salons/"+salonId+"/gallery/"))return;
        const figure=document.createElement("figure");
        figure.dataset.category=photo.category||"Otros";
        figure.style.cssText="margin:0;border-radius:12px;overflow:hidden;background:#24201b";
        const img=document.createElement("img");
        img.src=photo.imageUrl;img.loading="lazy";img.alt=photo.caption||"Foto de un trabajo del salón";
        img.style.cssText="width:100%;height:155px;display:block;object-fit:cover";
        figure.append(img);
        if(photo.caption){
          const caption=document.createElement("figcaption");caption.textContent=photo.caption;
          caption.style.cssText="padding:9px;font-size:13px;color:#f7ead3;overflow-wrap:anywhere";
          figure.append(caption);
        }
        grid.append(figure);
      });
      section.hidden=!grid.children.length;
    })
    .catch(()=>{section.hidden=true;});
})();
