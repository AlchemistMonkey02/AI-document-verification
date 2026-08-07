import os

def check_pdf(file_path):
    print(f"\n--- {file_path} ---")
    try:
        import pypdf
        reader = pypdf.PdfReader(file_path)
        text = ""
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text += t
        print("pypdf extracted length:", len(text))
        print("Snippet:", text[:500].replace('\n', ' '))
    except Exception as e:
        print("pypdf error:", e)

    try:
        import pdfplumber
        with pdfplumber.open(file_path) as pdf:
            text = ""
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t
            print("pdfplumber extracted length:", len(text))
            print("Snippet:", text[:500].replace('\n', ' '))
    except Exception as e:
        print("pdfplumber error:", e)

check_pdf("sathin.pdf")
check_pdf("mandrayal.pdf")
