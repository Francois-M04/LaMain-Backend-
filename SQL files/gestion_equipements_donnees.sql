TRUNCATE TABLE Intervention, Notification, Tache_Responsable, Tache, Equipement, Responsable, Institution RESTART IDENTITY CASCADE;
-- 2. INSERTION DES DONNÉES DE TEST (LaMain)

-- 1. Ajout de l'Institution
INSERT INTO Institution (nom_inst, adresse_inst, telephone, email) 
VALUES 
('ISTEAH', 'Cité du savoir, Genipaller', '+509 1234-5678', 'isteah@gmail.com'),
('Hôpital Central', '45 Avenue de la Santé, Cap-Haïtien', '+509 8765-4321', 'hopitalcentral@gmail.com');

-- 2. Ajout des Utilisateurs (1 Admin, 1 Technicien pour l'Université)
INSERT INTO Responsable (nom_responsable, numero, email, mot_de_passe, role, id_inst) 
VALUES 
('Wesley Alexis', '+509 1111-2222', 'wesleyalexis.isteah@gmail.com', '1234', 'Admin', 1),
('Benoît Paul', '+509 3333-4444', 'benoitpaul.isteah@gmail.com', '5678', 'Responsable', 1); 

-- 3. Ajout des Équipements
INSERT INTO Equipement (nom_equipement, categorie, localisation, etat, id_inst) 
VALUES 
('Génératrice Port-au-Prince', 'Génératrice', 'Port-au-Prince', 'Fonctionnel', 1),
('Imprimante HP LaserJet', 'Informatique', 'Port-au-Prince', 'En maintenance', 1); 

-- 4. Ajout des Tâches (Planifiées par l'Admin)
INSERT INTO Tache (titre_tache, type_tache, description_tache, date_echeance, frequence, statut, id_equipement) 
VALUES 
('Changement d''huile', 'Maintenance', 'Vidanger l''huile usagée et remplacer le filtre.', '2026-10-25 09:00:00', 'Trimestrielle', 'En attente', 1),
('Contrôle du toner', 'Contrôle', 'Vérifier le niveau d''encre et commander si nécessaire.', '2026-10-20 14:00:00', 'Mensuelle', 'En attente', 2); 

-- 5. Attribution des tâches aux techniciens (Table de liaison)
INSERT INTO Tache_Responsable (id_tache, id_responsable) 
VALUES 
(1, 2), 
(2, 2); 

-- 6. Le système envoie une notification (Rappel)
INSERT INTO Notification (message, id_tache, id_responsable) 
VALUES 
('Rappel : La tâche "Changement d''huile" arrive à échéance le 25 Octobre. Veuillez prévoir le matériel.', 1, 2),
('Alerte : Le niveau d''encre de l''imprimante HP est peut être bas. Vous devez faire le controle ce 20 Octobre.', 2, 2);

-- 7. Le Responsable réalise la tâche et valide (Intervention)
INSERT INTO Intervention (date_realisation, commentaire, cout_intervention, id_tache, id_responsable) 
VALUES 
('2026-10-17 08:45:00', 'Vidange effectuée. Filtre à huile remplacé. La génératrice fonctionne normalement.', 120.50, 1, 2);

UPDATE Tache SET statut = 'Terminée' WHERE id_tache = 1;
UPDATE Equipement SET etat = 'Fonctionnel' WHERE id_equipement = 1;

-- 8. La tâche de l'imprimante n'est pas faite (Blocage)
INSERT INTO Intervention (date_realisation, commentaire, cout_intervention, id_tache, id_responsable) 
VALUES 
('2026-10-17 14:15:00', 'Tâche impossible à réaliser. Rupture de stock de toner constatée. En attente de commande auprès du fournisseur.', 0.00, 2, 2); 

UPDATE Tache SET statut = 'Bloquée' WHERE id_tache = 2;
UPDATE Equipement SET etat = 'En attente de pièce' WHERE id_equipement = 2;

-- Pour prévenir M. Wesley l'Administrateur que du toner doit être commandé.
INSERT INTO Notification (message, id_tache, id_responsable) 
VALUES 
('Alerte : M. Benoît a signalé un blocage sur l''imprimante HP. Rupture de stock de toner. Action requise : Commander des fournitures.', 2, 1);