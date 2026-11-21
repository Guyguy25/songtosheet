"""Backup helper for the nightly workflow.

  db_backup.py name   <uri>                  print the database to back up
  db_backup.py counts <uri> <db> <out.json>  write document counts per collection
  db_backup.py verify <restored-uri> <db> <before.json>
                                              check that the restored copy matches
"""
import json
import sys

from pymongo import MongoClient

SKIP = {"admin", "local", "config"}
# Short-lived collections: their size moves during the dump, they are not compared.
VOLATILE = {"rate_limits", "email_codes", "login_limits", "track_chunks", "track_audio", "track_review_audio",
            "engine_state", "track_guest_limits"}


def name(uri):
    client = MongoClient(uri, serverSelectionTimeoutMS=20000)
    default = client.get_default_database(default=None)
    if default is not None and default.name not in SKIP:
        return default.name
    names = [n for n in client.list_database_names() if n not in SKIP]
    if len(names) != 1:
        sys.exit(f"Plusieurs bases trouvées ({names}) : ajoute le secret MONGODB_DB_NAME.")
    return names[0]


def counts(uri, db):
    database = MongoClient(uri, serverSelectionTimeoutMS=20000)[db]
    return {c: database[c].estimated_document_count() for c in database.list_collection_names()
            if not c.startswith("system.")}


def main():
    action = sys.argv[1]
    if action == "name":
        print(name(sys.argv[2]))
    elif action == "counts":
        result = counts(sys.argv[2], sys.argv[3])
        json.dump(result, open(sys.argv[4], "w"), indent=2)
        print(json.dumps(result, indent=2))
    elif action == "verify":
        before = json.load(open(sys.argv[4]))
        after = counts(sys.argv[2], sys.argv[3])
        problems = []
        for collection, count in before.items():
            if collection in VOLATILE:
                continue
            restored = after.get(collection, 0)
            if abs(restored - count) > max(5, count * 0.02):
                problems.append(f"{collection}: {count} avant, {restored} restaurés")
        for line in sorted(after.items()):
            print(f"  {line[0]}: {line[1]}")
        if not before.get("users"):
            problems.append("aucun compte dans la sauvegarde")
        if problems:
            sys.exit("Restauration incomplète :\n" + "\n".join(problems))
        print("Restauration vérifiée : toutes les collections sont là.")


if __name__ == "__main__":
    main()
