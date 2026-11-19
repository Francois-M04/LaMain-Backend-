-- REQUÊTE 1 : Afficher le tableau de bord des tâches avec l'équipement et le technicien
SELECT 
    t.titre_tache, 
    t.date_echeance, 
    t.statut, 
    e.nom_equipement, 
    r.nom_responsable
FROM Tache t
JOIN Equipement e ON t.id_equipement = e.id_equipement
JOIN Tache_Responsable tr ON t.id_tache = tr.id_tache
JOIN Responsable r ON tr.id_responsable = r.id_responsable
ORDER BY t.date_echeance ASC;

-- REQUÊTE 2 : Voir l'historique des interventions
SELECT
    i.date_realisation, 
    t.titre_tache, 
    r.nom_responsable, 
    i.cout_intervention, 
    i.commentaire
FROM Intervention i
JOIN Tache t ON i.id_tache = t.id_tache
JOIN Responsable r ON i.id_responsable = r.id_responsable;

-- REQUÊTE 3 : Voir toutes les notifications envoyées à Paul Martin
SELECT 
    n.date_envoie, 
    n.message, 
    t.titre_tache
FROM Notification n
JOIN Tache t ON n.id_tache = t.id_tache
JOIN Responsable r ON n.id_responsable = r.id_responsable
WHERE r.nom_responsable = 'Benoî Paul';