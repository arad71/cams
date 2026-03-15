# requirements: pytesseract, pdf2image, opencv-python, pillow
# sudo apt-get install tesseract-ocr
from pdf2image import convert_from_path
import pytesseract
import cv2
import json
import re
from collections import defaultdict
from pathlib import Path

PDF_PATH = "crossover-specification.pdf"
OUT_JSON = "extracted_crossover.json"

# 1) Convert PDF pages to images (we only need the form pages: 14 & 15 in your file)
pages = convert_from_path(PDF_PATH, dpi=300)
target_pages = {14-1, 15-1}  # zero-based indices for pages 14–15 from your PDF [1](https://dpaw-my.sharepoint.com/personal/zahurul_huq_dbca_wa_gov_au/Documents/Microsoft%20Copilot%20Chat%20Files/crossover-specification.pdf)

def ocr_with_boxes(pil_img):
    # Use Tesseract TSV to get words + positions
    tsv = pytesseract.image_to_data(pil_img, output_type=pytesseract.Output.DATAFRAME)
    # Clean rows without text
    tsv = tsv[tsv.conf.astype(str) != '-1']
    tsv = tsv.dropna(subset=['text'])
    return tsv

# 2) A tiny helper to get text to the RIGHT of a label, same line or next line
def read_field(tsv, label_regex, max_dx=800, max_dy=60):
    label = None
    for _, row in tsv.iterrows():
        if re.fullmatch(label_regex, row['text'].strip(), flags=re.IGNORECASE):
            label = row
            break
    if label is None:
        return ""
    lx, ly, lw, lh = label['left'], label['top'], label['width'], label['height']
    # Candidate words near and to the right
    candidates = tsv[(tsv['top'].between(ly - max_dy, ly + max_dy)) &
                     (tsv['left'] > lx + lw) &
                     (tsv['left'] < lx + lw + max_dx)]
    line_numbers = candidates.groupby('line_num')['left'].min().sort_values().index.tolist()
    # Take the nearest line to the right
    if not line_numbers:
        return ""
    line = candidates[candidates['line_num'] == line_numbers[0]]
    text = " ".join(line['text'].tolist())
    # Clean trailing punctuation/colons
    return text.strip(" :\t\r\n")

data = {
    "request_for_crossover_contribution_form": {
        "lot_owner_details": {"name":"", "phone":"", "email":"", "postal_address":""},
        "property_details": {"address_of_property_being_claimed_for":""},
        "signature": {"lot_owner_signature":"", "date":""},
        "eft_details": {"bank":"", "bsb_account_number":"", "account_name":""}
    },
    "crossover_application_form": {
        "lot_owner_details": {"name":"", "phone":"", "email":"", "postal_address":""},
        "property_details": {"address_of_property_requiring_crossover":"", "estimated_construction_date":"", "development_or_building_application_number":""},
        "declaration_acknowledged": False,
        "attachments": {"site_plan_required": True, "number_of_attachments":""}
    }
}

for i, pil_img in enumerate(pages):
    if i not in target_pages:
        continue
    tsv = ocr_with_boxes(pil_img)

    # Heuristics: detect which form page this is
    page_text = " ".join(tsv['text'].astype(str).tolist()).lower()

    if "request for crossover contribution" in page_text:
        # Contribution form (page 14) fields [1](https://dpaw-my.sharepoint.com/personal/zahurul_huq_dbca_wa_gov_au/Documents/Microsoft%20Copilot%20Chat%20Files/crossover-specification.pdf)
        d = data["request_for_crossover_contribution_form"]
        d["lot_owner_details"]["name"]  = read_field(tsv, r"(Lot|LOT)\s*Owner[’']?s?\s*Name", 900, 80)
        d["lot_owner_details"]["phone"] = read_field(tsv, r"Phone", 600, 80)
        d["lot_owner_details"]["email"] = read_field(tsv, r"Email", 900, 80)
        d["lot_owner_details"]["postal_address"] = read_field(tsv, r"Postal\s*Address", 1200, 100)
        d["property_details"]["address_of_property_being_claimed_for"] = read_field(tsv, r"Address\s*of\s*property\s*being\s*claimed\s*for", 1400, 120)
        d["signature"]["lot_owner_signature"] = read_field(tsv, r"Lot\s*Owner[’']?s?\s*Signature", 900, 80)
        d["signature"]["date"] = read_field(tsv, r"Date", 300, 80)
        d["eft_details"]["bank"] = read_field(tsv, r"Bank", 600, 80)
        d["eft_details"]["bsb_account_number"] = read_field(tsv, r"(BSB\s*and\s*Account\s*Number)", 1000, 80)
        d["eft_details"]["account_name"] = read_field(tsv, r"Account\s*Name", 900, 80)

    elif "crossover application" in page_text:
        # Application form (page 15) fields [1](https://dpaw-my.sharepoint.com/personal/zahurul_huq_dbca_wa_gov_au/Documents/Microsoft%20Copilot%20Chat%20Files/crossover-specification.pdf)
        d = data["crossover_application_form"]
        d["lot_owner_details"]["name"]  = read_field(tsv, r"(Lot|LOT)\s*Owner[’']?s?\s*Name", 900, 80)
        d["lot_owner_details"]["phone"] = read_field(tsv, r"Phone", 600, 80)
        d["lot_owner_details"]["email"] = read_field(tsv, r"Email", 900, 80)
        d["lot_owner_details"]["postal_address"] = read_field(tsv, r"Postal\s*Address", 1200, 100)
        d["property_details"]["address_of_property_requiring_crossover"] = read_field(tsv, r"Address\s*of\s*property\s*requiring\s*a\s*crossover", 1400, 120)
        d["property_details"]["estimated_construction_date"] = read_field(tsv, r"Estimated\s*construction\s*date", 900, 80)
        d["property_details"]["development_or_building_application_number"] = read_field(tsv, r"Development\s*or\s*building\s*application\s*number", 1200, 80)
        d["attachments"]["number_of_attachments"] = read_field(tsv, r"Number\s*of\s*attachments", 400, 80)
        # Declaration checkbox/acknowledgement: treat as present if sentence detected
        d["declaration_acknowledged"] = "declares that they will construct the crossover" in page_text

# 3) Persist JSON
Path(OUT_JSON).write_text(json.dumps(data, indent=2), encoding="utf-8")
print(f"Saved to {OUT_JSON}")