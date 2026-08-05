import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter

def filtrar_pliego_para_agentes(texto_pliego: str) -> dict:
    """
    Recibe el markdown completo del pliego, lo divide en chunks y usa ChromaDB (in-memory) 
    para extraer solo los fragmentos más relevantes para lo LEGAL y lo FINANCIERO.
    Devuelve un dict con {"legal": str, "financiero": str}
    """
    # 1. Chunking del documento
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1500,
        chunk_overlap=300,
        length_function=len,
        separators=["\n\n", "\n", " ", ""]
    )
    chunks = text_splitter.split_text(texto_pliego)
    
    # 2. Iniciar ChromaDB en memoria
    chroma_client = chromadb.Client()
    collection_name = "pliego_temporal"
    
    # Limpiar si ya existía (por seguridad en la misma sesión)
    try:
        chroma_client.delete_collection(name=collection_name)
    except:
        pass
        
    collection = chroma_client.create_collection(name=collection_name)
    
    # Agregar chunks (Chroma usa un modelo de embedding liviano por defecto o exact match)
    # Chroma por defecto usa 'all-MiniLM-L6-v2' para embeddings, que se descargará si es necesario
    collection.add(
        documents=chunks,
        metadatas=[{"source": "pliego", "chunk_id": i} for i in range(len(chunks))],
        ids=[str(i) for i in range(len(chunks))]
    )
    
    # 3. Consultas RAG
    query_legal = "requisitos habilitantes experiencia certificaciones ISO 9001 RUP capacidad jurídica pólizas seguros garantias"
    query_financiera = "capacidad financiera capital de trabajo índice de liquidez endeudamiento patrimonio presupuesto anticipos forma de pago"
    
    # Buscar top 15 chunks para legal
    results_legal = collection.query(
        query_texts=[query_legal],
        n_results=15
    )
    
    # Buscar top 10 chunks para financiero
    results_financiero = collection.query(
        query_texts=[query_financiera],
        n_results=10
    )
    
    # 4. Formatear salida
    texto_legal = "\n\n...[Fragmento recuperado]...\n\n".join(results_legal['documents'][0])
    texto_financiero = "\n\n...[Fragmento recuperado]...\n\n".join(results_financiero['documents'][0])
    
    # Limpiar DB
    chroma_client.delete_collection(name=collection_name)
    
    return {
        "legal": texto_legal,
        "financiero": texto_financiero
    }
