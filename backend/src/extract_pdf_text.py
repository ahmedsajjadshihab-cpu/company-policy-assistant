import sys
from pypdf import PdfReader


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(1)

    pdf_path = sys.argv[1]
    reader = PdfReader(pdf_path)
    pages = []

    for page in reader.pages:
        text = page.extract_text() or ""
        cleaned = " ".join(text.split())
        if cleaned:
            pages.append(cleaned)

    sys.stdout.write("\n\n".join(pages))


if __name__ == "__main__":
    main()
