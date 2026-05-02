import sys
import json
import math

import torch
from transformers import AutoTokenizer, AutoModel


CATEGORIES = [
    "Gas Leak",
    "Gas Supply Issue",
    "Pipeline Damage",
    "Meter Issue",
    "Billing Complaint",
    "Low Gas Pressure",
]

PROTOTYPES = {
    "Gas Leak": [
        "There is a gas leak and strong smell of gas",
        "Gas leaking from pipeline outside house",
        "Hissing sound and gas smell, urgent leak",
        "Gas pipeline burst and leaking",
    ],
    "Gas Supply Issue": [
        "No gas supply in the area",
        "Gas is not available and supply is off",
        "Gas outage and supply problem",
        "Gas supply stopped suddenly",
    ],
    "Pipeline Damage": [
        "Gas pipeline damaged and broken",
        "Pipeline is broken and needs repair",
        "Pipe line damage due to construction",
        "Gas line damaged outside street",
    ],
    "Meter Issue": [
        "Gas meter is not working",
        "Meter reading problem and meter fault",
        "Gas meter damaged and needs replacement",
        "Meter issue causing disconnection",
    ],
    "Billing Complaint": [
        "Gas bill is too high and incorrect",
        "Wrong billing charges and overcharged",
        "Complaint about gas bill and invoice",
        "Billing issue, wrong meter reading charges",
    ],
    "Low Gas Pressure": [
        "Low gas pressure and weak flame",
        "Gas pressure is very low",
        "Gas pressure problem in home",
        "Weak gas flow and low pressure",
    ],
}


def read_input():
    raw = sys.stdin.read().strip()
    if not raw:
        return {"complaint_text": ""}
    try:
        return json.loads(raw)
    except Exception:
        return {"complaint_text": raw}


def l2_normalize(v: torch.Tensor) -> torch.Tensor:
    denom = torch.norm(v, p=2, dim=-1, keepdim=True).clamp(min=1e-12)
    return v / denom


def embed_texts(model, tokenizer, texts):
    encoded = tokenizer(
        texts,
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="pt",
    )
    with torch.no_grad():
        out = model(**encoded)
        cls = out.last_hidden_state[:, 0, :]
    return l2_normalize(cls)


def softmax(scores):
    m = max(scores)
    exps = [math.exp(s - m) for s in scores]
    denom = sum(exps) if exps else 1.0
    return [e / denom for e in exps]


def main():
    payload = read_input()
    text = str(payload.get("complaint_text", "") or "").strip()
    if not text:
        print(json.dumps({"category": "Gas Supply Issue", "confidence": 0.0}))
        return

    tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")
    model = AutoModel.from_pretrained("bert-base-uncased")
    model.eval()

    proto_texts = []
    proto_labels = []
    for cat in CATEGORIES:
        for p in PROTOTYPES.get(cat, []):
            proto_texts.append(p)
            proto_labels.append(cat)

    proto_emb = embed_texts(model, tokenizer, proto_texts)
    text_emb = embed_texts(model, tokenizer, [text])[0:1, :]

    sims = torch.matmul(text_emb, proto_emb.T).squeeze(0)

    cat_scores = {cat: [] for cat in CATEGORIES}
    for sim, label in zip(sims.tolist(), proto_labels):
        cat_scores[label].append(sim)

    cat_avg = []
    for cat in CATEGORIES:
        vals = cat_scores.get(cat) or []
        cat_avg.append(sum(vals) / len(vals) if vals else -1.0)

    probs = softmax(cat_avg)
    best_i = int(max(range(len(CATEGORIES)), key=lambda i: probs[i]))
    best_cat = CATEGORIES[best_i]
    best_conf = float(probs[best_i])

    print(json.dumps({"category": best_cat, "confidence": best_conf}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)

