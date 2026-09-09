CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_tenant_id_id
  ON projects (tenant_id, id);

CREATE TABLE IF NOT EXISTS project_compasses (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_compasses_tenant_project
    FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects (tenant_id, id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_project_compasses_tenant_project'
      AND conrelid = 'project_compasses'::regclass
  ) THEN
    ALTER TABLE project_compasses
      ADD CONSTRAINT fk_project_compasses_tenant_project
      FOREIGN KEY (tenant_id, project_id)
      REFERENCES projects (tenant_id, id)
      ON DELETE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_project_compasses_tenant_project
  ON project_compasses (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_compasses_tenant_project
  ON project_compasses (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_compasses_project
  ON project_compasses (project_id);