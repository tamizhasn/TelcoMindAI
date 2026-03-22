import chromadb
import json
import os

# Initialize ChromaDB persistent storage
# Path should match your backend structure
client = chromadb.PersistentClient(path="./data/chroma_db")
collection = client.get_or_create_collection(name="telecom_policies")

def seed_data():
    """Initializes the vector DB with telecom policies if empty"""
    if collection.count() == 0:
        data_path = "./data/telecom_data.jsonl"
        if os.path.exists(data_path):
            with open(data_path, "r", encoding="utf-8") as f:
                documents = []
                metadatas = []
                ids = []
                for i, line in enumerate(f):
                    line = line.strip()
                    if not line: continue
                    try:
                        item = json.loads(line)
                        # Ensure we check for 'text' or 'policy' keys
                        content = item.get("text") or item.get("policy")
                        if content:
                            documents.append(content)
                            metadatas.append({"category": item.get("category", "General")})
                            ids.append(f"id_{i}")
                    except Exception as e:
                        print(f"⚠️ Error parsing seed line {i}: {e}")
                
                if documents:
                    collection.add(documents=documents, metadatas=metadatas, ids=ids)
            print(f"✅ RAG Database Seeded: {collection.count()} rules loaded.")

def retrieve_policy(query: str):
    """Searches for the most relevant policy. 
    Called via asyncio.to_thread in main.py to prevent blocking."""
    try:
        results = collection.query(
            query_texts=[query],
            n_results=1
        )
        if results["documents"] and len(results["documents"][0]) > 0:
            return results["documents"][0][0]
    except Exception as e:
        print(f"❌ RAG Retrieval Error: {e}")
    return "Standard Telecom Protocol applies."

# Auto-seed on import
seed_data()