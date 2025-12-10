CREATE DATABASE IF NOT EXISTS inventory_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE inventory_db;

CREATE TABLE IF NOT EXISTS inventory (
                                         id INT AUTO_INCREMENT PRIMARY KEY,
                                         inventory_name VARCHAR(255) NOT NULL,
    description TEXT,
    photofilename VARCHAR(255),
    photo VARCHAR(255)
    );

INSERT INTO inventory (inventory_name, description, photofilename, photo) VALUES
    ('Kipa', 'Живе у Львові', 'kipa.jpg', '/inventory/1/photo');
