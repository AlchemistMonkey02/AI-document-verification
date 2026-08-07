import docx

doc = docx.Document("1.docx")
text = "\n".join([p.text for p in doc.paragraphs]).lower()

keywords = ["work order", "कार्यादेश", "कार्य आदेश", "sanction", "स्वीकृति"]
for idx, kw in enumerate(keywords):
    # Print index instead of string to avoid unicode print issue
    print(f"Keyword index {idx} ('{kw.encode('ascii', errors='ignore').decode()}'): {'FOUND' if kw in text else 'NOT FOUND'}")
