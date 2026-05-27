#!/usr/bin/env python3
"""
Script para generar o actualizar el diccionario de combinaciones de glyphs
del Re(s)etario basado en los conceptos de economía recíproca.
"""

import json
import os

# Cargar conceptos base de glyphs
with open('scripts/glyph_concepts.json', 'r', encoding='utf-8') as f:
    glyph_concepts = json.load(f)

# Cargar el diccionario actual
with open('public/data/glyph-dictionary.json', 'r', encoding='utf-8') as f:
    dictionary = json.load(f)

# Definir cómo cada color modifica el concepto base
color_modifiers = {
    'standard': {
        'prefix': '',
        'context': 'en su forma base'
    },
    'blue': {
        'prefix': 'Gestión hídrica de',
        'context': 'aplicado al acceso y gestión del agua como bien común'
    },
    'green': {
        'prefix': 'Sistema alimentario de',
        'context': 'aplicado a la producción y distribución de alimentos'
    },
    'yellow': {
        'prefix': 'Espacio de cobijo para',
        'context': 'aplicado a la vivienda y espacios comunes'
    },
    'red': {
        'prefix': 'Energía para',
        'context': 'aplicado a la generación y gestión de energía'
    },
    'orange': {
        'prefix': 'Comunicación en',
        'context': 'aplicado a redes de información y coordinación'
    }
}

def generate_combination(glyph_id, color_key, glyph_concept):
    """
    Genera el meaning y description para una combinación glyph + color
    """
    concepts = glyph_concepts['glyphConcepts']
    glyph_key = str(glyph_id).zfill(2)
    
    if glyph_key not in concepts:
        return None
    
    concept = concepts[glyph_key]
    modifier = color_modifiers[color_key]
    
    # Generar meaning (título corto)
    if color_key == 'standard':
        meaning = concept['name']
    else:
        color_names = {
            'blue': 'Agua',
            'green': 'Alimento',
            'yellow': 'Cobijo',
            'red': 'Energía',
            'orange': 'Comunicación'
        }
        meaning = f"{concept['name']} - {color_names[color_key]}"
    
    # Generar description (descripción pedagógica)
    if color_key == 'standard':
        description = f"{concept['concept']} en economías recíprocas basadas en apoyo mutuo."
    else:
        description = f"{concept['concept']} {modifier['context']}."
    
    return {
        'meaning': meaning,
        'description': description
    }

def update_dictionary():
    """
    Actualiza el diccionario completo con las combinaciones generadas
    """
    print("🔄 Generando combinaciones para 32 glyphs × 6 estados...")
    
    updated_count = 0
    
    for glyph_id in range(32):
        glyph_key = str(glyph_id).zfill(2)
        
        if glyph_key not in dictionary['glyphs']:
            print(f"⚠️  Glyph {glyph_key} no encontrado en diccionario")
            continue
        
        glyph = dictionary['glyphs'][glyph_key]
        
        for color_key in ['standard', 'blue', 'red', 'green', 'orange', 'yellow']:
            combination = generate_combination(glyph_id, color_key, glyph)
            
            if combination:
                glyph['combinations'][color_key] = combination
                updated_count += 1
    
    print(f"✅ {updated_count} combinaciones generadas")
    
    # Guardar el diccionario actualizado
    output_path = 'public/data/glyph-dictionary.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(dictionary, f, ensure_ascii=False, indent=2)
    
    print(f"💾 Diccionario guardado en {output_path}")
    
    # Estadísticas
    print("\n📊 Estadísticas:")
    print(f"   - Total de glyphs: 32")
    print(f"   - Estados por glyph: 6 (standard + 5 colores)")
    print(f"   - Total combinaciones: 192")
    print(f"   - Actualizadas: {updated_count}")

if __name__ == "__main__":
    update_dictionary()
