import { Link } from "react-router-dom";
import { vehicleAssets } from "../assets";

export function Credits() {
  const model = vehicleAssets.find((asset) => asset.modelUrl);
  return <>
    <div className="page-heading"><p className="eyebrow">THE PEOPLE BEHIND THE PICTURES</p><h1>Visual credits</h1><p>Real work, properly credited. A little transparency about what you see.</p></div>
    {model && <section className="panel credits-model"><p className="label">Interactive Three.js model</p><h2>Porsche 911 Carrera 4S</h2><p>By <a href={model.modelSource}>{model.modelAuthor}</a>, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/">{model.modelLicense}</a>. The asset is distributed with the same licence. Its embedded creator metadata is retained.</p><p>{model.modelNote} This is a model-family illustration, not a scan of the selected car. The Cabriolet uses a photo fallback.</p><a href={model.modelUrl}>Download the credited GLB asset</a></section>}
    <p className="muted">Catalogue specifications and imagery have separate sources. Photos illustrate the named model, and may show a different colour, generation or trim. No photo represents live stock or a vehicle for sale.</p>
    <div className="credits-grid">{vehicleAssets.map((asset) => <article className="panel" key={`${asset.make}-${asset.model}`}><img src={asset.image} alt={`${asset.make} ${asset.model} reference`} loading="lazy" /><h2>{asset.make} {asset.model}</h2><p className="small">{asset.imageLabel}</p><p>Photo by {asset.author}.</p><p><a href={asset.source}>Original image & attribution</a> · <a href={asset.licenseUrl}>{asset.license}</a></p></article>)}</div>
    <p className="muted small">Photos have been resized and converted to WebP where indicated by their file extension. Credits and applicable licences are retained in the asset manifest. Vehicle names identify the subject; CarSage is independent of the manufacturers.</p><Link className="btn" to="/">Back to the showroom</Link>
  </>;
}
