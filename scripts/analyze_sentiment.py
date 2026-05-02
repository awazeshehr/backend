import sys
import json
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

def analyze_sentiment(text):
    analyzer = SentimentIntensityAnalyzer()
    
    # Custom Roman Urdu Lexicon
    roman_urdu_lexicon = {
        # Negative words
        'bura': -2.0, 'buri': -2.0, 'bure': -2.0,
        'ghatiya': -3.0,
        'bakwas': -3.0,
        'fazool': -2.0,
        'kharab': -2.0,
        'ganda': -2.5, 'gandi': -2.5,
        'sharam': -2.0,
        'afsos': -1.5,
        'pareshan': -2.0,
        'zillat': -3.0,
        'bekar': -2.0,
        'dukh': -2.0,
        'takleef': -2.0,
        'lanat': -3.5,
        'jhoot': -2.0, 'jhoota': -2.0,
        'badtameez': -2.5,
        'na-ahli': -2.0,
        'sust': -1.5,
        'mushkil': -1.5,
        'masla': -1.5, 'masle': -1.5,
        'shikayat': -1.0,
        'gandagi': -2.5,
        'badboo': -2.5,
        'toot': -1.5, 'toota': -1.5,
        'khatam': -1.0,
        'nakam': -2.0,
        
        # Positive words
        'acha': 2.0, 'achi': 2.0, 'ache': 2.0,
        'behtareen': 3.0,
        'zabardast': 3.0,
        'shukriya': 2.0,
        'khush': 2.0,
        'pasand': 2.0,
        'theek': 1.5,
        'behtar': 1.5,
        'badiya': 2.0,
        'zindabad': 2.5,
        'madad': 1.5,
        'hal': 1.0,
        'safai': 1.5,
        'saaf': 1.5,
        'meharbani': 2.0,
        
        # Domain Specific Negative (English)
        'leakage': -2.0, 'leaking': -2.0,
        'broken': -2.0, 'broke': -2.0,
        'damaged': -2.0,
        'garbage': -2.0, 'trash': -2.0,
        'smell': -2.0, 'stink': -2.0,
        'dirty': -2.0, 'filthy': -2.0,
        'polluted': -2.5,
        'overflow': -1.5, 'overflowing': -1.5,
        'blocked': -2.0, 'blocking': -2.0,
        'shortage': -2.0,
        'pothole': -2.0, 'potholes': -2.0,
        'unsafe': -2.0, 'dangerous': -2.5,
        'risk': -1.5,
        'sparking': -1.5, 'sparks': -1.5
    }
    
    analyzer.lexicon.update(roman_urdu_lexicon)
    
    scores = analyzer.polarity_scores(text)
    compound_score = scores['compound']
    
    # Context-aware override: 
    # VADER can be tricked by politeness markers like "Thank you" or "I would like".
    # If strong negative keywords exist, we prioritize them.
    text_lower = text.lower()
    strong_negative_keywords = [
        'angry', 'furious', 'upset', 'disappointed', 'frustrated',
        'worst', 'terrible', 'horrible', 'pathetic', 'useless',
        'ghatiya', 'bakwas', 'lanat', 'zillat', 'sharam',
        'not working', 'not available', 'no water', 'no electricity', 'no power',
        'not clean', 'not collected', 'very bad',
         'pani nahi', 'bijli nahi', 'gas nahi', 'nahi aa raha', 'nahi a raha',
         'masla hai', 'kharab hai'
     ]
    
    # Check for phrases manually
    is_negative = False
    for keyword in strong_negative_keywords:
        if keyword in text_lower:
            is_negative = True
            break
            
    if is_negative:
        # If user explicitly says they are angry/upset or uses negative phrases, it MUST be negative.
        # Even if "Thank you" (score +2.0) is present.
        if compound_score >= -0.05:
            compound_score = -0.1  # Force negative threshold
            
    if compound_score >= 0.05:
        label = 'Positive'
    elif compound_score <= -0.05:
        label = 'Negative'
    else:
        label = 'Neutral'
        
    return {
        "score": compound_score,
        "label": label,
        "details": scores
    }

if __name__ == "__main__":
    # Read input from stdin
    try:
        # Use stdin for handling large text blocks and special characters safely
        input_text = sys.stdin.read().strip()
        
        if not input_text:
            # Fallback to arguments if stdin is empty (though stdin is preferred)
            if len(sys.argv) > 1:
                input_text = " ".join(sys.argv[1:])
            else:
                # Return neutral if no text
                print(json.dumps({
                    "score": 0,
                    "label": "Neutral", 
                    "details": {"compound": 0, "pos": 0, "neu": 1, "neg": 0}
                }))
                sys.exit(0)

        result = analyze_sentiment(input_text)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
