import pdfplumber

def check_pdf(file_path):
    print(f"\n--- {file_path} ---")
    try:
        with pdfplumber.open(file_path) as pdf:
            text = ""
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t
            print("pdfplumber extracted length:", len(text))
            # Clean and print snippet safely
            clean_text = "".join([c if ord(c) < 128 else '?' for c in text])
            print("Snippet:", clean_text[:500].replace('\n', ' '))
    except Exception as e:
        print("Error:", e)

check_pdf("osr.pdf")
