-- CRÉATION DES TABLES (LaMain)
DROP TABLE IF EXISTS Intervention, Notification, Tache_Responsable, Tache, Responsable, Equipement, Institution CASCADE;

-- Table Institution
CREATE TABLE Institution (
    id_inst SERIAL PRIMARY KEY,
    nom_inst VARCHAR(100) NOT NULL,
    adresse_inst VARCHAR(255),
    telephone VARCHAR(20),
    email VARCHAR(100)
);

-- Table Equipement
CREATE TABLE Equipement (
    id_equipement SERIAL PRIMARY KEY,
    nom_equipement VARCHAR(100) NOT NULL,
    categorie VARCHAR(50),
    localisation VARCHAR(100),
    etat VARCHAR(50),
    id_inst INT,
    CONSTRAINT fk_equipement_inst FOREIGN KEY (id_inst) REFERENCES Institution(id_inst) ON DELETE CASCADE
);

-- Table Responsable
CREATE TABLE Responsable (
    id_responsable SERIAL PRIMARY KEY,
    nom_responsable VARCHAR(100) NOT NULL,
    numero VARCHAR(20),
    email VARCHAR(100) UNIQUE NOT NULL,
    mot_de_passe VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- Admin, Responsable
    id_inst INT,
    CONSTRAINT fk_responsable_inst FOREIGN KEY (id_inst) REFERENCES Institution(id_inst) ON DELETE CASCADE
);

-- Table Tache
CREATE TABLE Tache (
    id_tache SERIAL PRIMARY KEY,
    titre_tache VARCHAR(150) NOT NULL,
    type_tache VARCHAR(50),
    description_tache TEXT,
    date_echeance TIMESTAMP,
    frequence VARCHAR(50),
    statut VARCHAR(50), -- En attente, En cours, Terminée, Bloquée,
    id_equipement INT,
    id_responsable INT, -- Clé étrangère reliant la tâche à son responsable
    CONSTRAINT fk_tache_equipement FOREIGN KEY (id_equipement) REFERENCES Equipement(id_equipement) ON DELETE CASCADE,
    CONSTRAINT fk_tache_responsable FOREIGN KEY (id_responsable) REFERENCES Responsable(id_responsable) ON DELETE SET NULL
);

-- Table de liaison : Tache_Responsable (Relation N,N)
CREATE TABLE Tache_Responsable (
    id_tache INT,
    id_responsable INT,
    PRIMARY KEY (id_tache, id_responsable),
    CONSTRAINT fk_tr_tache FOREIGN KEY (id_tache) REFERENCES Tache(id_tache) ON DELETE CASCADE,
    CONSTRAINT fk_tr_responsable FOREIGN KEY (id_responsable) REFERENCES Responsable(id_responsable) ON DELETE CASCADE
);

-- Table Notification
CREATE TABLE Notification (
    id_notification SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    date_envoie TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id_tache INT,
    id_responsable INT,
    CONSTRAINT fk_notif_tache FOREIGN KEY (id_tache) REFERENCES Tache(id_tache) ON DELETE CASCADE,
    CONSTRAINT fk_notif_responsable FOREIGN KEY (id_responsable) REFERENCES Responsable(id_responsable) ON DELETE CASCADE
);

-- Table Intervention
CREATE TABLE Intervention (
    id_intervention SERIAL PRIMARY KEY,
    date_realisation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    commentaire TEXT,
    cout_intervention DECIMAL(10,2),
    id_tache INT,
    id_responsable INT,
    CONSTRAINT fk_inter_tache FOREIGN KEY (id_tache) REFERENCES Tache(id_tache) ON DELETE CASCADE,
    CONSTRAINT fk_inter_responsable FOREIGN KEY (id_responsable) REFERENCES Responsable(id_responsable) ON DELETE CASCADE
);