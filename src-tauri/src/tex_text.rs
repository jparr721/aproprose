pub const DEFINITION: &str = "\\providecommand{\\aproproseplain}[1]{#1}\n\\providecommand{\\aproprosenewline}{ }\n\\providecommand{\\aproprosereturn}{ }\n";

pub fn encode(value: &str) -> String {
    let mut output = String::from("\\aproproseplain{");
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\textbackslash{}"),
            '{' => output.push_str("\\{"),
            '}' => output.push_str("\\}"),
            '%' => output.push_str("\\%"),
            '&' => output.push_str("\\&"),
            '#' => output.push_str("\\#"),
            '$' => output.push_str("\\$"),
            '_' => output.push_str("\\_"),
            '^' => output.push_str("\\textasciicircum{}"),
            '~' => output.push_str("\\textasciitilde{}"),
            '\n' => output.push_str("\\aproprosenewline{}"),
            '\r' => output.push_str("\\aproprosereturn{}"),
            character => output.push(character),
        }
    }
    output.push('}');
    output
}

pub fn decode(source: &str) -> Option<String> {
    let body = source
        .strip_prefix("\\aproproseplain{")?
        .strip_suffix('}')?;
    let mut output = String::new();
    let mut rest = body;
    while !rest.is_empty() {
        if rest.starts_with('\\') {
            let escapes = [
                ("\\textbackslash{}", '\\'),
                ("\\textasciicircum{}", '^'),
                ("\\textasciitilde{}", '~'),
                ("\\aproprosenewline{}", '\n'),
                ("\\aproprosereturn{}", '\r'),
                ("\\{", '{'),
                ("\\}", '}'),
                ("\\%", '%'),
                ("\\&", '&'),
                ("\\#", '#'),
                ("\\$", '$'),
                ("\\_", '_'),
            ];
            let (escape, character) = escapes
                .into_iter()
                .find(|(escape, _)| rest.starts_with(escape))?;
            output.push(character);
            rest = &rest[escape.len()..];
        } else {
            let character = rest.chars().next()?;
            output.push(character);
            rest = &rest[character.len_utf8()..];
        }
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_round_trips_all_tex_metacharacters_and_literal_commands() {
        for value in [
            r"{unbalanced",
            r"} & % # $ _ ^ ~",
            r"\emph{literal} \",
            "  edge spaces  ",
            "two\nlines",
        ] {
            assert_eq!(decode(&encode(value)).as_deref(), Some(value));
        }
    }

    #[test]
    fn legacy_tex_is_not_silently_decoded() {
        assert_eq!(decode(r"\emph{legacy} \& \{brace\}"), None);
    }
}
