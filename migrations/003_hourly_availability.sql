-- Availability moves from 2-hour slots (0..6 = 10AM-12PM .. 10PM-12MN) to single hours (10..23 = 10-11AM .. 11PM-12MN).
-- Each old slot becomes its two hours, so nothing is lost.
CREATE TABLE availability_hours (
  host_id INT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK (hour BETWEEN 10 AND 23),
  PRIMARY KEY (host_id, date, hour)
);
INSERT INTO availability_hours(host_id, date, hour)
  SELECT host_id, date, 10 + 2 * slot FROM availability
  UNION
  SELECT host_id, date, 11 + 2 * slot FROM availability;
DROP TABLE availability;
ALTER TABLE availability_hours RENAME TO availability;
ALTER TABLE availability RENAME CONSTRAINT availability_hours_pkey TO availability_pkey;
CREATE INDEX availability_date_idx ON availability(date);
