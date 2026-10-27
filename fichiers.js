// Fichiers privés du garage (bucket « documents ») : envoi, téléchargement et envoi par mail.
// Un mail ne peut pas joindre de fichier depuis un navigateur : sur téléphone, on passe par le partage du système
// (Mail, WhatsApp…) avec le fichier lui-même ; sinon le mail contient un lien sécurisé valable 7 jours.
const Fichiers = (() => {
  const BUCKET = 'documents';
  const SEPT_JOURS = 7 * 24 * 3600;

  async function lien(chemin, duree = 300) {
    const { data, error } = await Sync.client.storage.from(BUCKET).createSignedUrl(chemin, duree);
    if (error || !data) throw new Error('Document introuvable.');
    return data.signedUrl;
  }
  async function blob(chemin) {
    const { data, error } = await Sync.client.storage.from(BUCKET).download(chemin);
    if (error || !data) throw new Error('Document introuvable.');
    return data;
  }

  async function envoyerFichier(fichier, chemin) {
    if (!Sync.role) throw new Error('Connecte-toi pour ranger des documents.');
    if (fichier.size > 10 * 1024 * 1024) throw new Error('Fichier trop lourd (10 Mo maximum).');
    const { error } = await Sync.client.storage.from(BUCKET).upload(chemin, fichier, { contentType: fichier.type || 'application/octet-stream', upsert: true });
    if (error) throw new Error('Document non envoyé : ' + error.message);
    return chemin;
  }

  async function telecharger(chemin, nom) {
    try {
      const b = await blob(chemin);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = nom || chemin.split('/').pop();
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { toast(err.message); }
  }

  async function envoyer(chemin, nom, sujet) {
    try {
      if (navigator.canShare && Photos.estTelephone()) {
        const b = await blob(chemin);
        const f = new File([b], nom || 'document', { type: b.type });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: sujet || nom }); return; }
      }
      const url = await lien(chemin, SEPT_JOURS);
      const corps = `Bonjour,\n\nVoici le document « ${nom} » :\n${url}\n\n(lien valable 7 jours)\n\nCordialement,\n${Param.get().garage.nom || ''}`;
      location.href = `mailto:?subject=${encodeURIComponent(sujet || nom)}&body=${encodeURIComponent(corps)}`;
    } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
  }

  return { envoyerFichier, telecharger, envoyer, lien };
})();
