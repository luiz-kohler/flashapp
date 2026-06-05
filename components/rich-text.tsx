import { Text, type StyleProp, type TextStyle } from 'react-native';

// Lightweight inline formatting: renders **bold** as bold spans inside a single
// Text (so numberOfLines still works). Everything else is plain text.
export function RichText({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) =>
        p.length > 4 && p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={{ fontWeight: '800' }}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        )
      )}
    </Text>
  );
}
