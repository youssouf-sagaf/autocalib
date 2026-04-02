Sagaf <> Raphael - Autocalib engineering - April 01
VIEW RECORDING - 93 mins (No highlights): https://fathom.video/calls/622697948

---

0:00 - Raphael Jatteau (Cocoparks)
  J'aurai besoin de lui après. Il est là. Il est là. Ce que je voudrais, tu vois, à la sortie de ce meeting, c'est qu'on puisse se dire, on a un vrai flux qui nous permet d'aller au bout.  On ne pas tout développer d'un coup. Et on est bien accordé sur, ok, tu vois, qu'est-ce qui est de l'ordre du manuel.  Effectivement, comme tu disais, est-ce que ça va être… Mais tu vois, faut presque penser un petit peu l'ergonomie des étapes manuelles parce que si, en fait, on ne la pense pas un petit peu en se rendant compte de est-ce que ça va être lourd ou pas, notre objectif qui est de dire qu'il faut au moins qu'il ait un impact de productivité sur l'absolute map, ou en tout cas qu'on n'augmente pas le nombre de tâches à faire, le temps passé sur le truc, il faut qu'on sente un peu les choses, tu vois.

1:00 - Sagaf Youssouf (Cocoparks)
  Imagine, après peut-être il faut refondre la création de l'Absolute Map, on charge une carte et l'Hub se rentre à l'adresse du parking, on va aller piquer le centre.  Après il faut trouver comment est-ce que c'est lui qui trace le rectangle, enfin tout le parking, qui va délimiter le parking, ou bien on se dit on rentre le centre de l'adresse, on va cropper sur 100 pixels sur 100, en rectangle un carré de 100 pixels sur 100, et c'est ça qu'on va utiliser comme input.  Et plus on reste focus sur le centre du parking ou de l'emplacement voirie, et mieux c'est.

1:54 - Raphael Jatteau (Cocoparks)
  C'est quoi le, tu vois effectivement, il faut sentir un peu à quel niveau. Le de zoom, le truc est performant.  Après, si le niveau de zoom est trop élevé, on peut dire que le truc va zoomer. Je vais essayer de te décrire mon flux idéal.  Est-ce que tu peux me montrer l'endroit, que je puisse copier-coller des photos, pour prendre quelques exemples, ou tu as pas mal d'exemples de résultats ?

2:16 - Sagaf Youssouf (Cocoparks)
  Ce que je vais faire, c si tu veux, je partage mon écran, tu fais des skins, ou je les envoie sur Slack ?

2:27 - Raphael Jatteau (Cocoparks)
  C'est quoi ?'est dans un Wimsy Call ? Non, c'était un local. Montre-les-moi en partage d'écran, et je te dis celles qui m'intéressent.  On sélectionne deux, trois pour faire le test du flux.

2:50 - Sagaf Youssouf (Cocoparks)
  En voivée ou en voivée ou en parking.

3:07 - Raphael Jatteau (Cocoparks)
  Oui, vas-y, on peut prendre un cas, un parking, un cas comme ça, ça va être pas mal ça. Oui, je te les scopturés.

3:18 - Sagaf Youssouf (Cocoparks)
  Et j'ajuste les marqueurs ou pas ? Oui, faisons ça, tu peux les ajouter.

3:23 - Raphael Jatteau (Cocoparks)
  Attends, je les copie-colle. Ok, il y a un cas en voirie. Celui-là, celui-là, celui-là est bien. Celui-là, celui celui-là est très bien.  Je le prends. Oui. C'est bon ? C'est bon. Donc, c'était quoi, tu disais, les questions que avais pour moi, là, sur… Tu disais que tu avais des questions tout à'heure.

4:22 - Sagaf Youssouf (Cocoparks)
  Je voudrais que l'UPS zoome sur l'emplacement, met l'adresse et se retrouve sur l'emplacement du parking.

4:30 - Raphael Jatteau (Cocoparks)
  Oui, tu… Non, ça,'est ce que tu me décrivais tout à'heure, mais tu disais que tu avais des questions tout à l'heure.  Enfin, on ne sait pas.

4:38 - Sagaf Youssouf (Cocoparks)
  Est-ce qu'on se dit que l'UPS va tracer un rectangle tout au long de l'emplacement, comme ça, on crée le masque au lieu d'utiliser Stegformer.  Si c'est l'UPS qui fait le masque, ça peut être très, très bien. Ça peut beaucoup, beaucoup être…

5:01 - Raphael Jatteau (Cocoparks)
  Parce qu'en fait, tu donnes en input à Secformer le schématique à reproduire, c'est ça ?

5:11 - Sagaf Youssouf (Cocoparks)
  Je lui donne l'image et il va aller chercher dans les endroits stationnables, c'est-à-dire entre la route et les immeubles.  Donc, il va faire un masque. Donc, tous les véhicules qui sont hors du masque, par exemple, les voitures qui roulent sur la route, on ne va pas les considérer.  Et on n'a pas besoin de générer des b-box pour les voitures qui sont sur la route. Et donc, le masque de la voirie permet de cadrer la génération des b-box manquants qui ne sont pas détectés par Riolo.  Donc, c'est vraiment un cadrage. Donc, ça veut dire que si tu as deux rangées, n'as pas besoin de générer un rectangle par rangée.  Tu fais un gros rectangle sur les deux rangées et ça passe. En voirie, tu fais un rectangle.

6:02 - Raphael Jatteau (Cocoparks)
  Pour moi, le but, c'est qu'à terme, non, mais ça peut être une option, tu vois, donc, pour moi, le point 1, tu vois mon écran là ?  Oui, je vois.

6:09 - Sagaf Youssouf (Cocoparks)
  Donc, le principe, c'est qu'on part d'une carte.

6:11 - Raphael Jatteau (Cocoparks)
  Donc, en fait, on est sur une carte comme ça, et, pour un exemple, voilà, ici, on est sur une carte comme ça, et le principe, c'est qu'on travaille avec des données géographiques, on va mapper une zone, donc on scrolle.  Le gars, scrolle, tu vois, et à partir d'un moment, il identifie son parking, tu vois. Et là, c'est là où il y un petit niveau de, il faut faire un petit peu, il faut que tu cadres le truc,'est, tu vois, si le gars, il dit, ah bah moi, j'ai toutes ces deux-là, il fait un énorme, il fait un énorme truc comme ça, vois, il dit, hop, moi, je prends tout ça.  En fait, c'est impossible, parce que, du coup, il y a énormément de zones à mapper, tu vois. C'est à partir de quel niveau de zoom on peut travailler le truc Le truc.  J'imagine un exemple d'ergonomie, il zoome, là il ne peut pas prendre le screen, il zoome, il zoome, il zoome, et là il y un truc qui lui dit, là tu peux commencer à faire ton, tu peux commencer à dire, je prends ça, je prends ça.  Idéalement quand il fait ça, on va travailler intelligemment dès le début, il y un raccourci clavier qui lui permet de prendre le screen, il appuie sur espace, tac, il scrolle, il appuie sur espace, il scrolle, il appuie sur espace, il scrolle, ou éventuellement on pourrait presque dire, tu vois, toute la zone, ça le prend automatiquement, si tu le mets en mode enregistrement, tac, et là il scrolle toute la zone, tac, tac, tac, et voilà, il a couvert la zone qu'il faut mapper, tu vois par exemple.  Donc là le but c'est quoi ?'est d'enregistrer la zone avec le bon niveau de zoom, on pourrait dire un jour, vois, ok, on part de loin, et c'est charge au système d'aller zoomer, et d'aller prendre tous les points qui sont dans le recoin, mais bon, ça après c'est des automatiques.  Là, peut lui demander de scroller les endroits où il doit mapper, tu vois, et de faire un clic pour bien enregistrer l'image de la zone.  Donc ça,'est le but, c'est d'avoir l'image d'input sur laquelle on va opérer. Donc, scroll.

8:19 - Sagaf Youssouf (Cocoparks)
  Dans ce cas, même s'il scroll, imaginons qu'il a fait un peu un screen, il scroll encore, il a fait un deuxième screen et ces deux zones-là se chevauchent.  Dans tous les cas, on va générer les marqueurs, les marqueurs vont se chevaucher et il choisira de prendre l'une ou pas l'autre.  C'est ça.

8:37 - Raphael Jatteau (Cocoparks)
  Ça, je pense qu'il faut que ce qui a déjà été fait soit visible directement et que le système, il dise, là, tu as déjà des trucs, vois, donc en fait, je ne vais pas réopérer dessus.  Tu vois qu'on enregistre bien les zones sur lesquelles on a déjà opéré. Donc, Existing, Apsmap, Visible, Visible. Existing Apps Map Visible, Activation of, comment on appelle ça, on va l'appeler Screen Registration via Keyboard, on re-clic.  Et nous, à partir du moment où on a le screen, tu vois, donc...

9:44 - Sagaf Youssouf (Cocoparks)
  Le screen, c'est lui qui va faire le rectangle ou bien il positionne la souris au centre de l'emplacement et nous on prend par rapport à des dimensions.  Parce que moi, ce que je fais, j'imagine que ce que je fais, il place la souris. Et je prends les dimensions 100 pixels sur 100 pixels.  Et ça permet d'avoir les données géoréférencées. Mais s'il fait un screen lui-même, ça veut dire qu trouver un...

10:12 - Raphael Jatteau (Cocoparks)
  Non, non, c'est pas ça que j'entends. Quand je dis screen, c'est le système d'enregistrement de la zone. Donc c'est Activation of Zone of Interest, on l'appelait ZOI, ou Region of Interest, Array Registration.  Array Registration Mode. Et le Array Registration, c'est quoi une Array Registration ? C'est une Region on Map. Et donc c'est With Map Coordinates, vois, c'est With Proper Map Coordinates.  Lat-longs, enfin, là c'est les Lat-longs, ça peut être les Lat-longs of Four Corners. Merci. Merci. Ça pourrait presque être un polygone si on veut.  Et après, tu as le RRI, la Region of Interest qui est Registered. Et tu on pourrait dire, tu vois, dans le scroll, tu es en train de scroller, tu vois, je vais le faire comme ça, tu es en train de scroller comme ça, toi tu veux dire ce que tu veux, et en fait, comment je peux te faire ça ?  Après, tu vois, le truc, c que si le système, il est assez fluide, il'y a peut-être pas besoin de faire ça, mais tu vois, de le dire, voilà.  Sur les tailles. Voilà, le truc est passé, et là je vais le faire sur deux, vois, mais ok, ça dépend s'il y des contraintes sur les tailles, vois, et en gros, alors c'est toujours la même taille d'écran, donc on va mettre ça comme ça, bref, tu vois, en fait, c'est un peu moche là comment je le fais, mais tu comprends le principe, tu vois, ok, on est sur notre carte, ces deux zones là sont déjà couvertes, un, si elles sont couvertes, on voit déjà l'absolute nappe, mais là quand il fait ses screens, il passe, il fait tac, tac, et on, éventuellement, tu vois, on peut trouver un moyen de dire, attends, ça tu viens de faire un screen dessus, ça peut aussi superposer, vois, s'il dit, en fait, ça fait un truc comme ça, et c'est pas grave, tu vois, il y a une overlap, et puis il crée,  Et une fois qu'il a fait ça, le RRI Registered, c'est finalement une zone, soit on peut dire c'est une liste de carrés, une liste de rectangles liés à l'écran Google Maps sur lequel on a scrollé, on a enregistré la zone.  Mais à la fin, c'est finalement une zone, tu pourrais dire c'est ça. En fait, je pourrais enregistrer ça, ça, ça, ça, ça, ça, ça, ça, ça, si j'ai tous ces cours-là, je suis capable de reconstituer à partir du moment où je sais que...  Ceux-là, ils sont ensemble, je peux reconstituer la zone, tu vois, qui est deux polygones, en fait. Mais tu vois, là, est-ce qu'on a besoin d'enregistrer les deux carrés ?  Peut-être pas, tu vois, à un moment donné, il les fusionner, vois, dire je les fusionne et c'est un truc qui cette forme-là qui est un peu bizarre et fine.  On pourrait aussi dire, tu vois, le truc s'opère parce qu'en cliquant, ça,'est une autre manière de faire. Mais après, là, on est déjà dans l'ergonomie, mais elle est importante pour pas que ça prenne trop de temps et qu'on soit cohérent.  Tu j'enlève ça et, en fait, je fais un système où, si je clique au centre ici, j'ai une zone d'intérêt qui, tu vois, je peux étendre une zone d'intérêt qui est un rond qui se crée comme ça, tu vois, avec ma roulette, touchez patte, tu vois, je clique, j'ai un rond qui se crée et après, je sauvegarde.  Bam ! Tu vois ? Et donc, ma zone d'intérêt, elle est ronde. Et je fais ça plusieurs fois, je scroll et je le fais en format rond plutôt qu'en format carré.  Honnêtement, on n'a pas grand chose à faire, ça pourrait en jeter un peu plus si on le fait en rond, mais on s'en fout, c'est un outil interne, je vois pas l'intérêt toi de forcément faire ça, vois, il a les gars qui font ça, ils font ça bien, j'ai vu leur outil, c'est vrai que c'est pas mal, eux ils sélectionnent des, en real time, special intelligence, ils sélectionnent des, tu font comme ça, et ça fait trois ronds comme ça, et tu sélectionnes et ça te donne de la data, je sais pas si on peut voir quelques screenshots, ça te donne de la data directe, tu vois, dans ton rond, vois, fine, mais est-ce que c'est nécessaire tout de suite de faire ça, peut-être pas, tu vois.  Donc, ça c'est, en gros, la sauvegarde des regions of interest. Une fois qu'on a ça, on peut se dire, bah maintenant on va bosser le...  Alors, est-ce qu'on le fait region of interest par region of interest, mais comment on va bosser le... On va lancer ton algo.  Mais ça, finalement, tu l'as déjà. Une fois qu'on a fait ça, next step, on lance, on fait un clic, on un on launch AppSnap Automation.  Là, ça lance, on pourrait voir les différentes étapes si on veut, mais tu as ton modèle plus segmentation, plus, pardon, segformer, plus postprocessing.  Automated, et là, Visualization of Results.

16:42 - Sagaf Youssouf (Cocoparks)
  Ouais. Est-ce qu'on a besoin d'être sur des screens ?

16:46 - Raphael Jatteau (Cocoparks)
  Non, pour moi, on doit rester dans l'outil Maps. On a besoin d'être sur des screens.

16:53 - Sagaf Youssouf (Cocoparks)
  Quand tu dis screen, tu veux dire... Sur des screenshots.

16:55 - Raphael Jatteau (Cocoparks)
  Sur des screenshots. Pourquoi on ne resterait pas sur l'outil Maps ? Là, on pourrait dire, j'ai Array Registered.

17:04 - Sagaf Youssouf (Cocoparks)
  Là, on n'a pas besoin de faire ce qu'il y Le pipeline peut, à partir des regions of interest, aller chercher le crop lui-même.  Exactement.

17:15 - Raphael Jatteau (Cocoparks)
  Et après, il réidentifie les pixels où il doit mettre les points, il est retraduit en lat long, tac, tac, tac, les trucs se créent.

17:21 - Sagaf Youssouf (Cocoparks)
  Il régénère les lat longs et ça s'affiche automatiquement. À partir des régions front terrestres, on va aller chercher les crops qu'on veut et on régénère des règles, c'est simple.  On régénère les lat longs.

17:39 - Raphael Jatteau (Cocoparks)
  Est-ce qu'on le fait sur My Maps, est-ce qu'on le fait sur Google Maps, sur Mapbox ? Effectivement, il faut qu une API pour pouvoir bien automatiser le truc.

17:52 - Sagaf Youssouf (Cocoparks)
  Il y a deux API, il y a IGN, c'est français, et Mapbox, je les ai utilisés tous les deux.

18:00 - Raphael Jatteau (Cocoparks)
  Oui, alors tu as appris des trucs, je n'ai aucun problème là-dessus, de toute façon, ce n pas le sujet pour le moment.  Mais tu vois, quand tu regardes les outils qu'on utilise aujourd'hui, on utilise quoi ? Google Maps, My Maps, OpenStreetMap.

18:15 - Sagaf Youssouf (Cocoparks)
  Donc bien sûr, il y a Mapbox, il y a truc, mais bon, OpenStreetMap, on l OpenStreetMap pour la carte, mais dans tous les cas, pour la carte, en gros, c'est des coordonnées de la langue, j'aurais gêné.  L'input, c'est un screen de satellite image.

18:35 - Raphael Jatteau (Cocoparks)
  Alors après, vois, comme il y des efforts manuels à faire, ne pas si ça, je ne pense pas que ça ait du sens de travailler sur le global tout d'un coup.  En fait, on peut dire, tu fais ta phase de scroll pour identifier les zones of interest, le système, il te dit, ok, basé sur les screens que tu m'as fait, on a 1, 2, 3 regions of interest.  Peut-être que s'il faut qu'il en segmente 2, parce que tu vois... Après, le truc, c'est que pour bosser sur la partie manuelle, il faut avoir un certain niveau de zoom.  En même temps, tu viens de me dire que si on est sur Maps, ce n pas un souci. En fait, on s'en fout.  Si on est sur Maps, on s'en fout. Donc, on clique en Launch Apps Map Automation. Le truc, il lance le post-processing, etc.  Et on visualise les résultats.

19:21 - Sagaf Youssouf (Cocoparks)
  En temps réel, il visualise et il recorige s'il le faut les résultats.

19:25 - Raphael Jatteau (Cocoparks)
  Exactement. Et donc, c'est là où on arrive maintenant. Alors, tu vois, la question qui peut se poser, c'est quand on lance ça, est-ce qu'il y a des données d'entrée qui peuvent être utiles ?'est ce que je pense.  Tu vois ? Et là, qui vont vraiment aider le truc, tu vois. Alors, on pourrait se dire, en fait, quand tu es là, aide-moi un petit peu.  Et avec un peu d'ergonomie, tu vois, tu me délimites un peu plus les zones. de stationnement, notamment si elles sont...  Je ne sais pas si c'est ça qui est utile, mais là on peut dire qu y a l'art, on fait des polygones comme ça pour aider, qui ne sont pas obligatoires, mais qui peuvent aider.  Mais est-ce que ça aide vraiment ? En fait, s'ils sont nécessaires, ce n'est pas un truc facultatif,'est un truc absolument nécessaire, ça ne sert à rien de dire que'est facultatif.

20:21 - Sagaf Youssouf (Cocoparks)
  Pour les HKS comme les zones où on a des arbres qui cachent les stationnements, on peut l'indiquer que c'est mieux de mentionner, de mettre le polygone, ce genre de cas.

20:33 - Raphael Jatteau (Cocoparks)
  Mais ils peuvent être mis après aussi, ils peuvent être mis en place après. Oui. Est-ce'on doit le mettre avant, est-ce qu'on doit le mettre après ?  Avant, c'est mieux.

20:51 - Sagaf Youssouf (Cocoparks)
  Comme ça, le pipeline, il segmente l'image et il régénère un truc spécifique là-dessus.

21:00 - Raphael Jatteau (Cocoparks)
  Donc dans ce cas-là, ce qu'on pourrait dire,'est qu'on peut toujours le faire après, mais on vous recommande en amont de faire un truc comme ça.  Et là, je pense qu'il ne pas faire un truc très lourd. C'est le gars, il passe sa souris, il appuie sur un keyboard, il appuie sur A et il fait tac, comme ça.  Il ne pas qu'on lui demande de faire des polygones X clics. C'est vraiment, tu me stabilotes les zones où tu penses qu'il faut faire les trucs de manière un peu plus en profondeur, par exemple.  Donc on pourrait dire, il y a une phase de input, stabiloting of covered areas ou quelque chose comme ça.  Et là, on pourrait compléter et on dit, tu vois, tu fais A plus... Hold, Click, and Draw. Tu vois ce que je veux dire ?  Et donc là, tu stabilotes la zone Covered, et on pourrait dire que as un autre mode, un autre raccourci, et tu fais B plus Hold, Click, and Draw, et ça te fait une autre couleur, parce que là,'est plus, j'en sais rien, tu vois, les zones de stationnement, j'en sais rien, tu vois, qui sont dans l'ombre, tu vois, je dis n'importe quoi, mais tu vois ce que je veux dire ?  On pense au fait que ce n pas que tu sélectionnes un truc avec un menu déroulant, tac, tac, ça doit être un truc,'est du dessin, ça doit être rapide, tu vois ?  Du dessin, oui. Mais là, pareil, je suis sur de'ergonomie, si au début, il faut le faire avec des clics, ce n pas grave.  Donc, on fait quelques petits éléments d'input, mais qui doivent être, il ne pas qu'il y en ait 50, et on lance le modèle Secformer plus Post-Prosseing Automatism, et on visualise le résultat.  Donc là, quand je veux visualiser le résultat, je suis comme ça, toi, tu as l'image d'origine, Tu as la Maps d'origine.  Alors attends, comment on va faire ça ? que tu as la Maps d'origine et tu as la nouvelle Maps.  Là, on est sur Maps. Le truc a été tracé. Et moi, j'aimais bien tes images intermédiaires. Tu peux me remontrer tes images intermédiaires, s'il te plaît ?  J'aurais dû les prendre tout à l'heure.

23:21 - Sagaf Youssouf (Cocoparks)
  Est-ce qu'on a réellement besoin pour l'Obs de lui montrer ça ? Ou juste la carte avec les marqueurs, c'est suffisant ?  Moi, je pense qu'il y a besoin.

23:32 - Raphael Jatteau (Cocoparks)
  Tu peux me rezoomer, là ? Tu peux zoomer ou pas ? Non ? Oui. Celle-là, elle ne marche pas.  Ça ne marche pas sur cette image-là.

23:47 - Sagaf Youssouf (Cocoparks)
  Attends, je vais la prendre quand même et on va en prendre une autre.

23:52 - Raphael Jatteau (Cocoparks)
  Ah, celle-là, est... Ouais, non, elle n pas beaucoup mieux. Je peux changer de... Et remets-moi l'autre, ça c'était l'autre qu'on a pris.  Remets-moi l'autre qui était le parking là.'était pas celle-là, pas celle-là. Non, c'est pas-là.

24:31 - Sagaf Youssouf (Cocoparks)
  C'est celle-là.

24:33 - Raphael Jatteau (Cocoparks)
  Donc là, tu peux zoomer pareil sur la partie de gauche. Voilà, Moi je pense que c'est ça le résultat en fait.  Alors, je reviens sur ce que je mettais du coup.

24:51 - Sagaf Youssouf (Cocoparks)
  On est là.

24:52 - Raphael Jatteau (Cocoparks)
  Tac. fait, ok, on a les points bleus. Donc là, en fait, on a un overlay sur la map, d'accord ?  Et en fait, tu vois, quand on va rajouter des trucs, ça va devenir complexe à lire, notamment si le truc s'est planté, tu vois ?  Donc, il faut forcément une visualisation où tu as la map vierge à gauche, pour retrouver la visualisation de base, et l'overlay à droite.  Même si on met un clic ou un toggle qui fait que tu rajoutes, que tu enlèves l'overlay, c'est pas pareil, tu tu vois pas les deux en même temps.  Donc, il faut voir les deux en même temps, et donc là, on va voir.

25:39 - Sagaf Youssouf (Cocoparks)
  On va voir un petit bouton pour voir les B-Box, une sorte de couche, de tulle, avec les B-Box, et une tulle avec l'image originale.  Ou bien, tu les mets côte à côte ? On les met côte à côte. Ou beaucoup de cartes côte à côte.  Deux cartes.

26:01 - Raphael Jatteau (Cocoparks)
  Ça fait deux cartes. Et l'original ? On est sur des cartes, donc tu peux scroller dessus. Par contre là, ce qui serait intéressant,'est potentiellement au moins un terme, mais d'avoir un synchronized scrolling.  Pas mal ça. Synchronized scrolling, c'est-à-dire que quand tu scrolles sur une map, ça scroll sur l'autre.

26:27 - Sagaf Youssouf (Cocoparks)
  Ok. Tu vois ce que je veux dire ?

26:29 - Raphael Jatteau (Cocoparks)
  Oui, d'accord, c'est la carte. Hein ?

26:32 - Sagaf Youssouf (Cocoparks)
  C'est la carte, c'est pas l'image. C'est la carte.

26:35 - Raphael Jatteau (Cocoparks)
  Ok.

26:36 - Sagaf Youssouf (Cocoparks)
  Donc je t'avais dit que je dois remonter les P-Box détecter aussi.

26:42 - Raphael Jatteau (Cocoparks)
  Ouais, parce que, comme on s'est dit, c'est intéressant d'enregistrer ça.

26:45 - Sagaf Youssouf (Cocoparks)
  Ouais.

26:49 - Raphael Jatteau (Cocoparks)
  Alors, en post-processing,'est-à-dire le post-processing complet, c'est-dire que si ça, on sait l'enlever en post-processing, vois l'image, le truc est là, il faut l'enlever.

26:58 - Sagaf Youssouf (Cocoparks)
  C'est c'est pas...

27:01 - Raphael Jatteau (Cocoparks)
  Donc on voit les centroïdes, on voit les trucs, et là en fait quels sont les enjeux à ce moment-là ?  C'est de faire des ajouts, là en fait on n'a pas encore sauvegardé dans l'appsmap, on a juste le résultat en temporaire, on n'a pas encore sauvegardé dans l'appsmap.  C'est de faire des ajouts ou des corrections qui sont de plusieurs ordres. C'est soit le truc à louper une place, ou des places, il faut en rajouter, je le marque là, c'est quoi les modifs possibles ?'est Add Slots, Remove Slots, et après je pense qu'il y a des sujets de modif, on a bien le slot, mais c'est de Modify Slots, et là ça peut être Orientation, ou Alignment.  J'ai vu des cas dans ce que tu as mis, et là il faut que ce soit ergonomique. Les points qu'on va prendre là, les centroïdes qu'on va prendre, c'est ce qui va faire demain les fonds de cartes.  Oui, tout à fait, c'est le but.

28:12 - Sagaf Youssouf (Cocoparks)
  Donc en fait, imagine, tu vois, il un petit effet de vague. C'est pas tout court, mais aussi la carte qu'on va visualiser.  Ah bah dans tout, dans les LVZ, la SNAP, c'est la base de tout.

28:26 - Raphael Jatteau (Cocoparks)
  Donc, s'il y un petit effet de vague sur la ligne et qu'il y a ça partout, on va avoir les effets de vague partout.  Donc en fait, tu vois là, là tu as un effet de vague. Donc je pense qu'il y a un sujet qui est un sujet d'alignement, tu vois.  Donc on va le faire en plusieurs étapes. Je veux add a slot. Par exemple, celui-là qui a été manqué là, tu vois.  Donc là, ce que j'aimerais, c'est je passe ma souris comme ça, tu vois. Et là, tac, il me propose un rectangle.  Est-ce que tu vois des algos qui peuvent dire, quand je passe là, je détecte les gradients ou les objets, mais pour arriver à, tu vois en fait, le truc, qu'il ferait, c'est, je vais donner un truc, je vais le faire de manière un peu n'importe comment, mais tu vois, tu passes sur l'arbre, il reconnaît l'arbre, la couleur, un peu comme, exactement comme dans Paint.net, tu vois ce que ça fait dans Paint, les...  Oui, je vois un peu ce que ça fait. Et ça pour moi,'est, ça rejoint le sujet de, un peu de la segmentation, tu vois, là si je fais un truc comme ça, et que je suis sur cet outil, oh merde, merde, je peux faire ça, que je fais cet outil là, et que je le mets en, ça c'est after click,  C'est quoi ça ? Comment il fait déjà ce truc ? Ah oui, c'est ça, c'est la pipette. Tu une tolérance, tu définis cette tolérance, et tu vois, ça c'est basé sur les couleurs.  Oui,'est assez fantastique. Et là, plus j'augmente la tolérance, plus ça va prendre des trucs aux alentours. Donc si je mets une tolérance très faible, il va prendre des tout petits points parce qu'il va détecter des gradientes partout.  Si je dose un peu ma tolérance, en disant tac, tac, tac, alors là, il est embêté parce que c'est blanc.  Mais sur des trucs comme ça, on va dire sur des places vides, je dose ma tolérance comme ça, et là j'ai le polygone.  Et donc là, je pourrais dire, toi, ok, j'ai pas une détection parfaite ici, donc je prends le polygone qui est là.  C'est extrêmement variable. Mais toi, qui est basé peut-être même sur les gradients des places à côté ou je ne pas quoi, je clique là, je vois l'objet et en fait, du coup, ça me permet de reproduire le rectangle d'un côté et de l'autre.'est-à-dire que je fais, je vais le mettre comme ça, les clics, vais les mettre comme ça.  Je clique ici, ça me prend le rectangle, je le reproduis ici, boum, terminé. Ou je clique ici et ça génère le rectangle bien orienté, tu vois.  Il faut qu trouve une technique pour que juste l'input manuel en un clic ou en hover, tu vois, te distingue la forme et j'ai juste à cliquer pour confirmer.  Et ça, pour le coup, ça doit être, pour le coup, ultra fiable parce qu'après, bien sûr, on peut toujours ajuster les trucs.  Mais là, on ajuste une place, tu vois, avec un polygone et le centroid, de toute façon, il est défini dans la foulée.  On voit que'est trop compliqué de dire je clique là, je clique là,'ai le truc qui se met en place.  Même s'il un petit temps de latence, tu cliques là, attends deux secondes, boum, le truc se met en place,'est ok.  5 secondes ce sera trop. L'autre option c'est de dire en fait j'ai ça qui n pas été pris, je clique, je fais clic droit à gauche ou j'en sais rien, enfin je fais un truc avec un raccourci clavier, ça me copie-colle le rectangle vert, tu vois ça fait un truc comme ça, je me mets là, je fais, je sais pas, c'est plus clic, tac, ça me fait un truc, je fais c'est clic, ça me le copie-colle, hop j'ai juste à le glisser, je le mets là, hop enregistré c'est fini.  Donc il y a l'enjeu de copier-coller pour les ajouts de place, et pareil ici, tu vois si je dois en rajouter un, c'est...  le même principe, tu vois. Et là, moi, tu vois, je pense qu'il faut le faire en raccourci clavier, tu vois.  C'est-à-dire que t'as tes raccourcis, tu vois, par exemple, on peut le... Ça, c'est de'ergonomie, mais qui est importante tout de même par rapport à ce qu'on fait là.  A, B, C, D, tu vois, j'en sais rien. Et tu vois, quand la personne, elle clique sur B, imaginons que...  Non, on va faire plus simple. D soit Delete. Elle a sa petite vignette ici qui dit Delete et activé.  Je peux plus de la bonne forme, je pense que c'est que ça. Tu vois, Delete et activé. Et du coup, là, quand il fait son Delete, à chaque fois qu'il clique, ça delete les boxes.  Bon.

33:58 - Sagaf Youssouf (Cocoparks)
  Il clique sur A et...

34:00 - Raphael Jatteau (Cocoparks)
  Il maintient le A appuyé, Add, ça lui met ici qu'il n'est plus en Delete, il est en Add, comme ça ils s'en souviennent, et là il clique, Add, et après il y a Copie, qui un autre mode, j'en sais rien, tu vois,'il faut qu'on en ait plusieurs, et le mode Copie, là tu cliques sur une boîte, la copie direct, sans faire un clic droit Copier, clic droit Coller, ça ça marche pas.  Ça, je pense qu'avec Cursor et tout, on peut faire un truc très rapide si on l'a bien spécifié, mais pourquoi j'insiste sur, tu vois, tu me dis pourquoi tu me détailles l'ergonomie, moi je fais de la CV, c'est parce qu'en fait, c'est ça qui fait que ça rend possible le complément dans un temps qui est raisonnable, et en fait ça, on peut améliorer le modèle autant qu'on veut, on aura toujours besoin de compléments manuels, et toujours, toujours, même si on n'aura jamais du 100%, comme tu le sais.  Oui, tout à fait. Donc en fait, les bases qu'on met là, elles vont nous être utiles par la suite, tu vois.  Donc on essaie de faire un truc bien pensé dès le début. Donc là on fait un petit truc comme ça, donc il peut soit copier, soit add, ou là ça reconnaît la forme, un peu comme le paint là, et le delete qui est, j'ai une place entre autres, par exemple celle-là, tac, là il n'y même pas à se poser de question, il appuie sur D, il clique, boum, c'est deleté.

35:23 - Sagaf Youssouf (Cocoparks)
  D'accord ?

35:24 - Raphael Jatteau (Cocoparks)
  Évidemment, il faut le petit... Le petit truc pour retourner à l'arrière. Exactement. Tu vois que j'ai fait ? Ah oui, c'est mis là.  Dans notre toolbox, tu vois, on a notre toolbox qui est là quoi. Ça c'est notre toolbox. La toolbox de l'Absolute Mapper.  Ok ? Pas mal !

36:00 - Sagaf Youssouf (Cocoparks)
  Il ne prend pas une demi-screen, il prend 4 screens de l'ordi, pas comme à l'Absolite Map d'aujourd'hui, il prend une demi-screen.

36:08 - Raphael Jatteau (Cocoparks)
  Il que ça prenne toutes les screens de l'ordi. Ah ouais, il faut que ce soit très gros et qu'on puisse scroller en synchronisé, comme ça, tu vois.  On scroll, on scroll, et on complète. Et puis à la fin, quand il a terminé ? De toute façon, l'enregistrement se fait au fil de ces modifications, donc on a fini, etc.  Alors, est-ce que toi, tu vois dans les aspects de modification, tu vois, donc là, il n'a pas détecté sur les arbres, ou je n'en sais rien, donc il peut les rajouter en manuel, mais est-ce que tu penses qu'il y a des endroits où, même une fois le truc produit, ça aura du sens que le gars dise, attendez,  Vous n'avez complètement pas détecté, par exemple d'ailleurs, je n pas mis la même image, on n'a pas détecté cette zone-là, et donc je veux que tu retravailles cette zone-là, et on relance le modèle, spécifiquement sur cette zone-là, en zoomant plus.  Est-ce que ça, tu penses que ça a du sens ?

37:22 - Sagaf Youssouf (Cocoparks)
  Ça a du sens si c'est à noter, mais sinon si tu relances, il ne va pas pouvoir détecter, il va te donner la même chose.

37:28 - Raphael Jatteau (Cocoparks)
  Oui, parce que toi, tu auras déjà fait ton tiling, ça ne sert à rien de refaire le truc. Est-ce que tu vois des choses où la personne pourrait rajouter une autre image, pour ne pas juste dire, après vous le faites en manuel, à vous de jouer les gars.  On pourrait rajouter des éléments de contexte, de ci, de ça, qui font que le truc sera meilleur.

37:52 - Sagaf Youssouf (Cocoparks)
  Comme il est enregistré, on peut avoir un petit bouton pour relancer, parce que c'est comme de l'annotation. Pour relancer, enregistrer.  C l'image avec ce qu'il a déjà enregistré et relancé derrière. Un petit bouton pour refresh.

38:10 - Raphael Jatteau (Cocoparks)
  En fait, oui, ce qui peut être intéressant, moi ce que j'ai compris de ce que tu disais tout à l'heure,'est qu'imaginons que cette poche-là, le truc a été complètement zappé.

38:20 - Sagaf Youssouf (Cocoparks)
  Cette poche-là, ici, vois.

38:21 - Raphael Jatteau (Cocoparks)
  Donc, nous, a été là, mais il a complètement zappé ce truc-là. Tu vois, de dire, je crée une B-Box, comme ça, pour montrer un peu le pattern, et là, je te redis ensuite, retravaille ça, quoi.  Ah, c'est possible.

38:36 - Sagaf Youssouf (Cocoparks)
  Il en fait une et ça régénère le reste. Et là, il est meilleur.

38:40 - Raphael Jatteau (Cocoparks)
  Oui, c'est possible.

38:43 - Sagaf Youssouf (Cocoparks)
  C'est exactement ce que fait le post-processing. Tu lui donnes une, il regarde le masque et il régénère par rapport à la taille que tu as faite, jusqu'à ce qu'il s'approche du masque.  Là, pour le coup, il va en faire trois et descend en bas, il va en faire deux. Oui, ça,

39:00 - Raphael Jatteau (Cocoparks)
  Ça peut être un moyen de dire, soit vous complétez en bouchant les trous, supprimez les places avec les raccourcis qu'il là, et pour ajouter, s'il y a vraiment une zone qui a été zappée, vous mettez un b-box, vous vous entourez, et vous relancez le processing, ça refait la même chose, et après vous repassez en manuel s'il faut recompléter.

39:18 - Sagaf Youssouf (Cocoparks)
  Il n même pas besoin de relancer, tu fais le rond et ça s'auto-ajoute. Bah voilà, oui.

39:25 - Raphael Jatteau (Cocoparks)
  Auto-add after adding one example plus round. Et là pareil, vois, donc là il faut que notre toolbox de raccourcis, elle permette de faire ça facilement, donc tu vois ce serait, là le add, c'est pas le même, c'est un add de la même manière, donc là on utiliserait, j'aime bien l'idée de la toolbox,'est vraiment, franchement ça c'est ouf en fait, quand t'as des outils, parce que tu sais ce que j  Enfin, tu ne sais pas ce que j'ai en tête. Ce que j'ai en tête, c'est que dans le futur, ce truc-là, ce n pas nous qui allons le faire.  Quand on va démarrer avec une ville, qu'est-ce qu'on va leur dire ? Le mapping, on va vous faire un base mapping, le complément, le truc, tout ça, on vous forme, c à vous de le faire.  Have fun. Et à chaque region of interest, vous nous faites un virement. Non, mais tu vois ce que je veux dire ?  C'est-à vous avez un crédit de 1000 slots par an, et si vous voulez en faire plus, il faut en faire plus.  Parce qu'on ne va pas non plus leur donner une infinité de trucs à faire, une infinité de slots possibles.  Tu vois ce que je veux dire ? Donc, c'est pour ça que j'insiste sur l'ergonomie du cockpit, pour dire demain.  Ce truc-là, ça doit être fait vraiment par d'autres. Avec l'ergonomie qu'on a aujourd'hui, c'est impossible. Les A, B, les petites B-Box, les grosses B, c'est impossible.  Un macro de traumatisme. Demain, c'est... Merde. Évidemment, il y a un long chemin à faire avant ça. Donc, là, ils entourent, ils font ça.  auto-add after adding one example plus round. Et donc là, on va utiliser le add. La réalité,'est qu'en fait, y aura peut-être, je ne pas, 10 raccourcis.  Mais, je'arrive pas à le faire. Et donc, on va rajouter ici, par exemple, tu vois le R, add, delete, et il y le round.  Ou j'en sais rien, tu vois, le reprocess. Reprocess, c'est mieux. Et donc quand tu cliques sur R, ça t'active ton petit stylet, tu fais le R, bam, et ça fait le auto-add.  Ça c'est juste pour se dire, en fait, ces trucs-là vont être simples,'est pas 10 000 clics à chaque fois, et on voit une ergonomie qui fait sens et qui permet vraiment de travailler intelligemment.  Toi, en parallèle, tout ce qui est les trucs qui ne sont pas détectés en addition, tu enregistres, tu vois, le flux, c'est-à-dire de dire, la base, reprocessed, reprocessed steps, et manual additions.  On enregistre ça intelligemment, avec des calques, des trucs, etc., qui permettent de se dire, tu vois, en fait, sur chaque itération,  À la fin, on a un weakness report, enfin pas pour un humain, mais weakness report, processable by AI. Une fois que tu as le résultat, il faut que l'IA puisse dire, je regarde l'avant, est-ce qu'il dû être fait en manuel, et du coup j'en déduis des zones de faiblesse.  Et là peut-être que du LLM est intéressant, on peut dire, là on n pas été bon, là on n pas été bon, et donc je peux réinjecter des trucs.  Là, je ne te donne pas la réponse de comment on fait ça, je ne sais pas quel est le bon format, mais l'intelligence, sur le principe de'intelligence, elle est là.  C'est que quand tu fais ça, tu te donnes une chance vraiment d'améliorer le truc à fond en utilisant ce que les gens vont faire.  Ce côté-là, je ne sais pas comment tu les entraînes les trucs. Tu vois une piste là-dessus ?

44:04 - Sagaf Youssouf (Cocoparks)
  Une fois que as le manuel, tu enregistres, ça te fait des labels, et dans la semaine, tu re-entraînes avec les manuels qui ont été faits, ou bien après avoir fait l'absoluble de nouveaux clients, tu récupères les manuels qui ont été faits, et tu relances.

44:27 - Raphael Jatteau (Cocoparks)
  Ce qui fait que quand tu as un new model plus segformer, tu peux retest en former cases, en disant les gars avant ont rajouté 5 manuels sur cette image, avec le nouveau truc, on sait qu'on n fait plus que 2.  Puisque en fait le résultat tu l'as, le résultat définitif tu l C'est génial ça, retest on former cases.

45:06 - Sagaf Youssouf (Cocoparks)
  Tu as fait office d'annotation pour améliorer le modèle. Enfin, c'est ça en fait.

45:11 - Raphael Jatteau (Cocoparks)
  Ça fait office d'annotation, mais tu vois, tu dis, il a cette bbox-là qu'on n'a pas. Comment tu lui dis, en fait, modèle, dans ce contexte-là, global, tu n'as pas été capable de détecter ça.  Si tu lui envoies juste la bbox, ça ne répond pas aux besoins, tu vois. Je ne pas sûr que ça réponde complètement aux besoins, tu vois.  Donc, c'est quoi le processable ? Comment ?

45:32 - Sagaf Youssouf (Cocoparks)
  Un LLM pour regarder autour pour voir est-ce que c'est parce qu'il y a un arbre ou est-ce que c'est l'analyse de par zone.  Pour le coup, l'analyse par zone, l'LLM, il le fait bien. OK.

45:47 - Raphael Jatteau (Cocoparks)
  Bon, tu vois, j'ai juste que c'est cette partie-là, processable by AI. On réinjecte et quand on a un new modèle, on reteste sur toutes les images passées pour vérifier qu'on réduit bien le nombre de manuels qui auraient dû être faits puisqu'on a la base.  Après, le truc,'est que quand tu vas le refaire, tu vois, quand le modèle va ressortir le truc, il va te sortir une b-box comme ça, peut-être, tu vois.  Donc ça, il faut bien considérer que quand même, a fait un bon job et qu'il a bien répondu, tu vois.  Ok ? On est pas mal, là. Donc, on commence à avoir un truc qui fait sens. Après, ça, c'est sur la partie jaune.  Je vais le mettre en jaune. Le point dont on n'a pas parlé, là, c'est l'alignement. Donc, j'ai mes boîtes, d'accord ?  Et elles sont comme ça. Je pense que ce qu'il nous faudrait, à un moment donné, c'est un truc qui est capable de dire que ça, en fait, ça doit être aligné comme ça.

46:57 - Sagaf Youssouf (Cocoparks)
  Je pense qu'il y a des trucs qui existent et qui font ça automatiquement. Pratiquement. En fait, que tu préfères, c'est avoir un petit bouton, et tu cliques dessus, on a un système qui analyse si les points sont alignés mais légèrement décalés, et paf, ils corrigent.

47:13 - Raphael Jatteau (Cocoparks)
  Et là, du coup, moi, que je vois dans un truc comme ça, c'est, ok, je mets un truc, peu importe le nom, mais qu'on pourrait appeler Al.  Il y déjà la question des parkings en curve. Ah oui, alors, sur un parking en curve, dans tous les cas, le truc est curvé, est-ce qu'on peut réajuster manuellement ?  Cliquez sur cette boîte-là, ajustez un petit peu, tu vois, mais il'y pas d'enjeu, c'est déjà curvé, vois, donc il n pas de soucis.  Ce n pas grave si on voit un petit peu de décalage ou des trucs, dans tous les cas, si on veut retravailler un petit peu, on revient, on fait un...  On réajuste un peu la b-box. Par contre, l'idée, c'est qu'avec un des raccourcis, tu cliques sur Align, et effectivement, tu fais un hover sur ce point-là, par exemple.  Donc toi, es là avec celui-là. Et là, directement, il te dit, moi, je vois cet alignement-là. Et là, si on dit, je valide, ça réaligne les b-box, les centroid pour que ce soit aligné.  Je fais un hover, pareil. Le truc détecte les lignes. Je fais un hover ici, il va détecter la ligne, il va te la mettre là.  Il va te dire, tiens, je peux te faire cette ligne-là. Et on réaligne les trucs. Je pense que, du coup, quand on fait ça, on réaligne, et forcément, le centroid peut être comme ça, ça ne pas forcément aligner les b-box, c'est pas grave.

48:57 - Sagaf Youssouf (Cocoparks)
  Donc là, dit les b-box,'est-à-dire, il est là.

49:02 - Raphael Jatteau (Cocoparks)
  En fait, la réalité, c'est que le long d'une ligne, les B-Box, elles sont censées toutes avoir le même angle.  Ah, ok. Bah oui, du coup, sont censées avoir le même angle, donc là, sont comme ça. Imaginons que tu veux les tourner un tout petit peu comme ça, parce que c'est plus proche de la réalité.  Toi, on pourrait dire, je fais le hover ici, il me détecte la ligne jaune, la ligne rose, d'accord ?  Il détecte la ligne rose, et après, je scroll un petit peu, donc là, il me sélectionne toutes les B-Box qui sont comme ça, tu vois ?  D'accord ? Alors, elles ne sont pas superposées comme ça. Il les sélectionne parce qu'elles sont le long de la ligne, et je scroll un peu, et en fonction de comment je scroll, tac, ah non, non,'est pas comme ça.  Et en fonction de comment je scroll, hop, il ajuste un tout petit peu les B-Box, mais elles ont toutes le même angle.  Et donc ça, on va se le noter, là, c'est le...

50:00 - Sagaf Youssouf (Cocoparks)
  Ça fait vraiment un outil de travail. Exactement.

50:05 - Raphael Jatteau (Cocoparks)
  Alignment Mechanism, parce qu'on sait qu'on va en faire des centaines et des centaines. Alignment Automate, je ne sais pas comment on l'appeler.  donc lui, tu vois, tu fais Hover, On, Dots, Auto-Detext, Auto-Detext, Line with Neighboring Points, Select Existing V-Boxes, Underline, Align, Angles.  On a juste comme ça, c'est à peu près ça le principe. Et du coup, on un vrai module d'alignment qui est important parce qu'après, sur toutes les cartes, on le visualise comme ça.  Je me demande s'il n a pas des outils, des trucs, des plugins qui ne font pas déjà ça. Mais bon, en fait, cet investissement-là, c'est des heures et des heures de gagné après.  Et la qualité visuelle, tu vois, la qualité de visualisation sur l'app dans le futur et sur Cocopilot. Et une fois qu'on a ça, une fois qu'on a fait tout ça, on save.

51:52 - Sagaf Youssouf (Cocoparks)
  Et t'as une très belle carte.

51:57 - Raphael Jatteau (Cocoparks)
  Save all elements. Bboxes, Plus, Plots. Oui, exactement, tu as une belle carte, et un process de réenrichissement du système pour que ce soit encore plus performant.  Alors, tu vois, si on fait ça, si on résume les étapes, on en a combien ? Scroll, Activate Error Registration 1, 2, 3, par exemple, Launch Automation, Special Inputs, il faudrait qu les compte.  1, 2, ça ne marche pas, ça fait 1, 2, ça,'est pas une rémenu de tape, 3, 4, 5, 6, 10.  Et après, as, en fonction du résultat, Additions, Potential Auto Additions, Alignment Automation, 3, 4, 5, en fonction des segments, et tu aboutis à un truc.  Donc, tout ça, si ce n'est pas ultra fluide, ça fait quand même 10-15 étapes, donc il faut que ce soit solide.  Aujourd'hui, quand on fait l'ApsMap, qu'est-ce qu'on a comme étape ? On a A, B par segment, ajustement de la taille en enseignant 3 mètres, 4 mètres, voilà, on refait ça segment par segment, comptage des segments, comptage du nombre de places, c pour tomber sur exactement les bons centroïdes, réajustement manuel, en gros, on est à peu près déjà sur le même nombre de trucs.  Sauf que tu n pas un truc scalable. Ce truc-là, avec le réenregistrement et tout ça, il donne un potentiel scalable.

54:09 - Sagaf Youssouf (Cocoparks)
  Moi, je trouve quand même le fait d'aller chercher, compter, chercher la taille, le process, il était assez lourd quand même, pour ce qu'on a aujourd'hui.  C'est très lourd, je suis d'accord.

54:21 - Raphael Jatteau (Cocoparks)
  Là, c'est lourd, c lourd,'est lourd, c'est c'est lourd,'est lourd,'est lourd,'est lourd. Mais ça, on peut dire que ça vient après.  Une fois que tu as les marqueurs, tu vois ça, tu dis, tac, ça c'est, tu vois, on fera un truc qui dit, ça c'est une livraison, ça c'est un truc qu'on pourra le faire facilement.  Le détecter vu de haut ne sera pas forcément possible, mais ça se fera ça de toute façon sans problème.

54:50 - Sagaf Youssouf (Cocoparks)
  Si on a une sorte de donnée, je ne sais pas, j'imagine qu'il y a une carte avec les emplacements et tout ça, on peut aller regarder.

55:37 - Raphael Jatteau (Cocoparks)
  Donc là, on a un truc avec un bon potentiel, on va vérifier si ça peut s'appliquer à la voirie.  Donc là, dans ce cas-là, on scrolle, définit la région, il nous dessine des places. Le résultat que tu avais, c'était un truc comme ça.  Donc là, ah oui, parce qu'il a détecté les bateaux. Ça marche bien pour les marinas, ton truc là. Donc là, imaginons qu'il fasse vraiment un truc bizarre comme ça.  Moi, je veux mapper les quatre places qui sont là et peut-être ces places-là en interdites.

56:15 - Sagaf Youssouf (Cocoparks)
  Bah, s'il fait son rond, dès qu'il aura fait son rond, les autres places, les autres détections, il prend pas fond.

56:26 - Raphael Jatteau (Cocoparks)
  Alors, le seul truc auquel on n pas pensé, là, que je trouve intéressant quand je vois ça, c'est de supprimer en bloc.  Moi, c'est de pouvoir dire, je prends mon scribble, je fais ça et je lui dis, voilà, tout ce qu'il y là-dedans, tu le supprimes.
  ACTION ITEM: Test satellite imagery sources (Google Maps, IGN, Mapbox) for multi-temporal views - WATCH: https://fathom.video/calls/622697948?timestamp=3396.9999  Parce que s'il faut cliquer sur chaque truc, t'es bon. Est-ce qu'il n a pas un moyen, Sagaf, quand t'es en vue satellitaire, de récupérer, toi, plusieurs images satellitaires de différents moments ?

56:58 - Sagaf Youssouf (Cocoparks)
  J'ai testé ça. J'ai testé sur Mapbox, et du satellitaire français dont je t'en ai parlé, ça s IGN. Et quand je regarde les deux, côte à côte, c'est toujours la même vue.  Et ce que je peux faire, c'est tester avec Google Maps ou autre source de données, pour voir si la vue va changer.

57:23 - Raphael Jatteau (Cocoparks)
  D'accord. Si on résume les outils qu'on a, on a un ROI Registrator, qui doit être ergonomique. On a un Bilateral MapSinker.  Je réfléchis aux différents blocs fonctionnels. On a un... Évidemment,'Auto Apps Map Generator, qui est quand même le cœur du cerveau, High Brain, comme sur Cursor.  Là, c'est quand même un High Map Auto Apps Map Generator Engine. On a un, après c'est la modification, donc on va appeler ça un, ça c'est un module ergonomique, c'est un Apps Map Completion Lightning  Lightning Completion Tool, Lightning Edition, Edition c'est plus large, Lightning Edition Module, tu vois c'est en fait ce truc là, le truc bleu que j'ai mis là, c'est un vrai truc qui est un asset de modification de Maps, tu de l'Apps Map qui doit être en soi un truc avec des vrais objectifs en soi quoi.  Il y a le Auto-Add After-Adding, donc ça c'est un, on va dire on a un Reprocessing Helper, Apps Map Generator Reprocessing Helper, Reprocessing Helper, et on a un truc là qui est...  Pour moi, vient avec, on ne peut pas le mettre sans limite, qui est un Engine Retraining Loop. Systématique, on l'appelait comme ça, Systématique Engine Retraining Loop.  Ça, c'est la loop qui est là. Et on a, ça, n pas vraiment de'édition, vois, l'alignment, ce n pas vraiment de l'édition.  C'est un refinement, quelque chose comme ça.

1:00:56 - Sagaf Youssouf (Cocoparks)
  Merci.

1:01:06 - Raphael Jatteau (Cocoparks)
  On l'appelle comme ça. Alignment Automation Tool. Mettre au carré, tu vois, c'est alignment, mise au carré, automation tool. On a six gros modules, tu vois, avec des trucs où l'enjeu, ici, c'est plutôt du front slash mapping.  Ça,'est vraiment du front slash mapping classique. C'est marrant à faire, mais c'est pas très compliqué. Là, as un vrai AI Engine.  Ça, c'est lourd. L'intelligence, elle est là.'est-à-dire que l'étape 3, plus l'étape 3 est bonne, plus ça s'implique. J'évite tout le reste en fait.  Apps Map Link Edition Module, on est sur du Mapping. Mapping plus Product Engineering plus UX, c'est les enjeux. Reprocessing Helper.  Là, tu as quand même un enjeu de comment le reprocessing et quel type de data je donne, à quel point je dois être précis.  Donc, tu as un petit enjeu de AI Understanding et il a Input Quality plus, après c'est Mapping, c'est Front, on va dire Front.  Mais tu vois, c'est important de savoir à quel point ça doit être bien dans le même angle. Est-ce que il faudrait, j'en sais rien, tu vois, est-ce qu'il en faire un pas rangé ou tu vois.  Et ça, c'est... Là, il a un petit enjeu quand même technique de détection des lignes qui, je pense, il doit y avoir un truc qui existe, mais qui  Qui n pas comme ça limpide, c'est pas du front.

1:03:05 - Sagaf Youssouf (Cocoparks)
  aussi les modules algorithmiques qui font ça. Il y un peu de maths là, oui.

1:03:13 - Raphael Jatteau (Cocoparks)
  Un peu de maths.

1:03:15 - Sagaf Youssouf (Cocoparks)
  Math algo plus front.

1:03:17 - Raphael Jatteau (Cocoparks)
  Après c'est du front pour avoir l'ergonomie, etc. Donc clairement le cœur de la machine c'est celui-là. Aujourd'hui il nous donne suffisamment de confiance pour avancer, malgré le fait qu'on n'ait pas beaucoup refiner le truc.  Et tu vois dans, je dirais dans ce qu'on doit penser là pour avoir un truc qui tourne bien, c'est, je pense qu'ici c'est quoi le format de ce truc-là.  Ça c'est important parce que, sans le développer, mais de se dire vraiment de quelle data j'ai besoin quand je fais ce process pour bien sauvegarder les éléments qui me permettent de réentraîner.  Ça je pense que ça vaut le coup d'être formalisé. Et sur le reste, niveau de difficulté, moi je te le mets comme je le mets là, on dire que...

1:04:13 - Sagaf Youssouf (Cocoparks)
  Eh oui, sur un échelle de 1 à 10, je le mettrais sur 4, sur le frontman.

1:04:33 - Raphael Jatteau (Cocoparks)
  L'automate, pour moi, ça c'est vraiment le 9 sur 10, la fin. Et le 6, ça, tu vois, en fait, moi je te dis comment je le vois.  Allez, on va être généreux. Ça c'est un 9 sur 10, ça c'est un 10 sur 10. Le format, tu veux dire...  Pas le format, le format c'est ce par quoi je pense qu'il faut qu'on commence. C'est là-dessus, mais le plus dur, c'est l'intelligence qu'on met dans cette retraining loop.  L'anticiper, pour que ce soit rigoureux et que ça injecte vraiment des datas clean qui ont un impact énorme direct, je pense que c'est ça le plus dur.  Parce que tu vois, à la limite, ton modèle de base, il n'est pas très bon. Fine. Si tu as une vraie vision de comment tu réentraines au fil de l'eau et que ça te fait un truc ultra précis, à la fin, fait, peu importe ton point de départ, arriveras à tes fins.  Tout à fait, oui.

1:05:37 - Sagaf Youssouf (Cocoparks)
  Mais c'est dur. Ça,'est très dur de se projeter là-dessus.

1:05:40 - Raphael Jatteau (Cocoparks)
  AppSnap Lightning Edition Module, tu mettrais quoi là ?

1:05:46 - Sagaf Youssouf (Cocoparks)
  Absolute Map Lightning Edition. Bon, il y a pas mal de sous-outils, mais y a un petit 6 sur 10 par rapport à différents outils qu'on a.

1:05:56 - Raphael Jatteau (Cocoparks)
  Oui.

1:05:59 - Sagaf Youssouf (Cocoparks)
  AppLadir. Pour le coup, il y a la partie AI Input, je n pas à projeter là-dessus, donc j'ai 7 sur 10.  Ce n'est pas le point du système, peut-être 6 sur 10. Je pense que c'est plus dur que l'Edition Module.

1:06:21 - Raphael Jatteau (Cocoparks)
  L'Edition Module, c'est une histoire de front, d'ergonomie et de bien penser le truc. Techniquement, truc-là, effectivement, il est un peu plus compliqué.  Mais si tu t'appuies sur ça au début en disant que ça, ça va tourner, tu n pas obligé de faire le truc parfait.  Tu vois, ça va être lié, tu vas refaire une haute là-dessus avec quelques éléments complémentaires. Tu vois bien comment le faire.

1:06:42 - Sagaf Youssouf (Cocoparks)
  Je pense que'est beaucoup moins compliqué que ce truc-là.

1:06:45 - Raphael Jatteau (Cocoparks)
  Beaucoup plus compliqué que ce truc-là, mais moins compliqué que ce qu'il y a ici. Et mise au carré Automation Tool, ça, c'est pas évident.

1:06:55 - Sagaf Youssouf (Cocoparks)
  Je vois un système où tu sélectionnes un point et tu as un truc. Qui va scanner sur la ligne.

1:07:06 - Raphael Jatteau (Cocoparks)
  On sait que globalement, tous les points sont sur la même ligne.

1:07:11 - Sagaf Youssouf (Cocoparks)
  Et il va scanner sur un rectangle de 5 pixels de largeur, par exemple, tout autour là, jusqu'aux zones du masque, par exemple.  Et tac, il les met sur le même alignement.

1:07:30 - Raphael Jatteau (Cocoparks)
  Et alignment, misocaré, automation tool, là, tu... Après, il a l'angle aussi, à corriger. C'est pas évident. Moi, ça, je mettrais 7 sur 10, par exemple, tu vois.  Par contre, ces trucs-là, t'as mis 4 sur 10, moi, je les mettrais même en dessous.

1:07:53 - Sagaf Youssouf (Cocoparks)
  5.

1:07:55 - Raphael Jatteau (Cocoparks)
  Ça, moi, je les mettrais même en dessous. C'est vraiment le ROI registré.

1:08:00 - Sagaf Youssouf (Cocoparks)
  C'est un système où tu as deux maps, quand tu scrolles ici, l'autre il suit, en deux secondes tu demandes à Tudupiti, il te dit comment faire.

1:08:11 - Raphael Jatteau (Cocoparks)
  C'est 3 sur 10, moi je le mettrais comme ça. Et le ROI Registrator,'est tu scrolles et tu enregistres des trucs.  Il un petit enjeu d'ergonomie pour afficher le truc comme il faut derrière, pour bien montrer ce qui a été enregistré.  Il y a quand même si dans le ROI, tu vois le fait d'identifier les trucs déjà mappés pour ne pas aller les refaire.  Donc ça il faut sauvegarder ça quelque part. Donc soit quand tu scrolles, il y a déjà des marqueurs, donc on ne touche pas à cette zone.

1:08:50 - Sagaf Youssouf (Cocoparks)
  Soit tu régénères tous les marqueurs et quand tu vas placer les marqueurs, il y a déjà des marqueurs. Dans ce cas, tu ne lasses pas.

1:09:03 - Raphael Jatteau (Cocoparks)
  Moi, je pense qu'il faut qu'il soit déjà visible et qu'on ne relance pas le process sur les trucs qui ont déjà été travaillés avec le manuel, le reprocessing et tout.  C'est sanctuarisé, tu ne peux pas le relancer.

1:09:13 - Sagaf Youssouf (Cocoparks)
  Mais imagine par exemple sur Sandeni, Sardagariga, et tu as une autre rue. Et rue qui sont très proches. Tu fais ton héroïque, parce qu'il va toucher là où tu as déjà monté.

1:09:30 - Raphael Jatteau (Cocoparks)
  Tu as une expansion. C'est juste que tu vois, en fait, quand on va dire, voilà, on va travailler telle zone, ça va mettre en région of interest que la zone, en enlevant l'autre, tu vois.  Mais effectivement, il y a un petit enjeu quand même de bien se cadrer là-dessus, bien se caler.

1:09:52 - Sagaf Youssouf (Cocoparks)
  Qu'est-ce qu'on se dit sur les actions à faire là ? Moi, je dois ingurgiter tout ça et repenser un peu.  Tous ces blocs, je peux faire mes engines, CV, AI, et webcoder un petit front pour simuler tout ça, comme ça, mais un point sans redit pour intégration, ça me prendra une semaine et demie ou deux semaines.
  ACTION ITEM: Define retraining loop data format and performance metrics - WATCH: https://fathom.video/calls/622697948?timestamp=4214.9999

1:10:25 - Raphael Jatteau (Cocoparks)
  Moi je pense que ça, il faut qu s'écrive, il d'abord... Le format ? Oui, le format l'aise.

1:10:41 - Sagaf Youssouf (Cocoparks)
  Le training loop.

1:10:42 - Raphael Jatteau (Cocoparks)
  Les visions de retraining loop, ce qui va être censure durant et après le processus And what will be now to assess the new performance of the updated models.
  ACTION ITEM: Define line/angle alignment method; then implement Alignment Automation Tool - WATCH: https://fathom.video/calls/622697948?timestamp=4271.9999  Je pense que tu vois, si on regarde les plus durs, il y a ça. Je pense que le mise au carré, je pense que mathématiquement, faut une méthode, right ?  C'est pas développé, mais je pense que là, y a des choses qui existent et il faut se dire, ok, ça va pas être compliqué.  C'est pas des modèles d'IA ou je sais pas quoi, clairement, ça doit pas être ça, mais il faut pas exactement comment le faire.  faut écrire la méthode et après, on aura tout le loisir de la développer. Les Processing Helper, je pense qu'il n pas d'enjeu à cet endroit-là.  Lightning Edition Module, il a pas d Il y a une décision à prendre sur comment on dev ça. Est-ce qu'on peut le faire aujourd'hui en vibe coding dans un truc parallèle ?-ce que ça c'est pertinent ou est-ce qu se dit non, là on fait un dev plus classique parce qu'on ne sent pas trop avec Cursor ?  Moi je pense qu'il n pas de raison.

1:12:41 - Sagaf Youssouf (Cocoparks)
  Pour visualiser les résultats, en cas pour moi, j'ai préparé un point. Je ne vois pas comment je peux le faire sans visualiser via, pas toutes les fonctionnalités, mais une grosse partie quand même.  Et basé sur ce que tu as commencé à faire là.

1:12:57 - Raphael Jatteau (Cocoparks)
  Oui. Tu peux... Le truc, c'est que si on veut que ce soit scalable et reprenable par la suite, il faut vraiment segmenter les objectifs fonctionnels.
  ACTION ITEM: Draft modular architecture + specs; then build Cursor prototype (ROI, dual-map, edit, auto-add, reprocess) - WATCH: https://fathom.video/calls/622697948?timestamp=4383.9999  Il ne pas faire un code où on dit « tiens, j'ai envie de tout faire, bilateral map sync ».  Il faut vraiment dire « je crée une fonction qui est un error registrator, elle a son code, son module, et après j'ai un module qui est vraiment le truc qui permet de visualiser les deux maps, qui est synchée, pour bien isoler les parties, et peut-être qu'il faut… » pourrait se dire « write the modular architecture and it specs by module ».  Et ensuite, une fois qu'on a ça, on fait « fastpock with cursor », fastpock with 4.6 » ou un truc comme ça, ça va nous coûter peut-être 50 balles.  Il lancer le truc, mais si on a bien nos modules, qu'on a bien pensé les connexions des modules, Et on réutilise derrière pour l'innovation.  Tu vois ? Module en architecture, en fait je pense qu'il y d'abord, on l'a de module en architecture, il y a details, specs by module, il ne pas faire les deux en même temps, c'est d'abord les modules et comment ils vont être.

1:14:26 - Sagaf Youssouf (Cocoparks)
  Et puis il va penser à ce que tu vas intégrer tout de suite, il ne pas penser à un modulaire.

1:14:32 - Raphael Jatteau (Cocoparks)
  Oui, exactement. Et c'est ça, une fois que tu as les specs, tu as 7 fiches qui sont peut-être énormes, qu'on a fait tout le boulot d'ingénierie, en input sur curseur, ça doit donner un truc.

1:14:56 - Sagaf Youssouf (Cocoparks)
  Ok, ok.

1:15:01 - Raphael Jatteau (Cocoparks)
  Rappelons-nous un truc, je pensais à ta question tout à l'heure, est-ce qu'on ne penserait pas tout de suite aussi aux autres parties de l'autocalibre ?  Quand on réfléchissait un petit peu à comment on va agencer les images ou les trucs comme on le faisait ici, on s'est rendu compte que d'avoir une numérotation ordonnancée des places, ça avait du sens.  Donc en fait, là on n'a pas de numérotation, mais sur des places qui sont sur un même peigne, je vais appeler ça une même rangée, être capable de dire que toi t'es la 1, et toi t'es la 2, 3, 4, 5, et donc toi t'es  On peut le garder pour plus tard, mais on peut le garder pour plus tard, mais peut le garder pour plus tard.  On peut le garder pour plus tard, je pense que un peu préliminaire. La question qu'on peut se poser, c'est, tu vois, avant de lancer le Fastpock with Opus, est-ce que ça, on ne taquerait pas les sujets de, ok, comment on voit la partie calibre derrière ?  Mais je pense que c'est un peu tôt, c'est un peu tôt, un peu tôt, Under Interfaces. Un des éléments qu'il y a après, qui est hyper important, c'est, je pense qu n pas d'enjeu, en fait,'est deux enjeux différents, c'est, tu vois, le mapping des lampadaires, avec les outils qui mappent déjà les lampadaires, c'est un autre sujet, ça vient superposer à l'Apps Map, finalement, mais c'est un autre sujet.  On peut faire cette info et la mettre dessus.

1:17:54 - Sagaf Youssouf (Cocoparks)
  Non, en fait, ça fera un calque complémentaire, quoi.

1:17:58 - Raphael Jatteau (Cocoparks)
  Ça va, mais... Si on a ça, la méthode sur la mise au carré, et qu'on a cette partie-là, pour moi, on peut dire qu'on sait qu'on va aboutir sur cette partie-là.  Ça, ce serait bien d'avoir ça cette semaine.

1:18:22 - Sagaf Youssouf (Cocoparks)
  Au vendredi. De toute façon, t'es full dedicated là-dessus. C'est jouable.'est jouable.

1:18:53 - Raphael Jatteau (Cocoparks)
  Allez, à suivre. Mais ok, là, je pense qu'on est dans une direction. Mais tu vois, par rapport à ce que tu disais, moi, quand tu me dis, on va fine-tuner le modèle, tant que j'ai pas cette vision-là, où je me dis, ok, en fait, on a un truc qui peut aboutir, qu'on va pouvoir compléter, je suis pas serein, tu vois, honnêtement, quand on démarre le call, je pense que c'est possible, mais tant qu'on s'est pas écrit tout ça, je me dis, la partie manuelle, ça va être simple, c'est loin d'être simple, ce qu'on vient de faire là, parce que tu vois, imagine, tu en cliques, en cliquant, en en cliquant, cliquant, ou normalement, tu peux te dire, si j'ai pas pensé à une ergonomie un peu simple, là, est plus compliqué que ce qu'on fait aujourd'hui.

1:19:35 - Sagaf Youssouf (Cocoparks)
  Je pense que...

1:19:37 - Raphael Jatteau (Cocoparks)
  Et avec ça ?

1:19:38 - Sagaf Youssouf (Cocoparks)
  Il ne faut pas faire la ergonomie avant de se lancer dans les chantiers AI.

1:19:44 - Raphael Jatteau (Cocoparks)
  Avant de penser quoi ?

1:19:46 - Sagaf Youssouf (Cocoparks)
  Avant de se lancer dans les chantiers AI Engine. Parce que moi, quand je suis dedans, et comme ça n'a pas, si j'ai vraiment la ergonomie, bouton a défi.  Il faut que j'arrive à 100%. Tu passes une semaine, jour à aller chercher ce pourcentage-là, et pourtant, il y a un choix qui peut être fait d'ajouter un petit bouton ad, et ça te fait un petit à l'église.

1:20:18 - Raphael Jatteau (Cocoparks)
  En fait, quand tu le fais, quand tu parles du bouton ad, justement, ce n pas un petit bouton ad.  C'est volontairement pour ça que j'ai donné des noms, et que j'ai dit que c'est un AppSmap Lightning, Edition Module, volontairement.  Tu vois, je dis, c'est un truc, ça envoie du lourd. Alors, ça peut être simple dans le code, ça peut être une demi-journée de travail, pas dix jours, mais la manière dont tu vas le faire, le temps de réactivité du truc, c'est ça qui va faire que c'est effectivement un truc qui permet de s'autoriser de ne pas être à 100% ou de ne pas être à 99% tout de suite.  Donc, en fait, moi, je le vois complètement différemment de ce que tu dis, je ne le vois pas comme un petit bouton A, je le vois  C'est comme un module, une fonctionnalité cœur indispensable pour que la fonctionnalité globale d'Auto Apps Map fonctionne. Et ça fait partie des éléments cœur qu'on va travailler, itérer, améliorer, rendre plus ergonomique pour qu'à la fin le truc soit intuitif.  Regarde Superhuman, t'avais testé Superhuman ou pas ? Ils l'avaient testé, oui.

1:21:31 - Sagaf Youssouf (Cocoparks)
  Ils l'avaient testé, mais comme je ne tripe pas un flux énorme, je l'ai désactivé.

1:21:35 - Raphael Jatteau (Cocoparks)
  Voilà, mais moi Superhuman, ils se sont fait racheter, c'est une success story. C'est quoi l'interface ? Regarde, c'est des mails qui se succèdent dans un dark mode.  T'as quelques éléments là, mais est-ce que c'est mieux que Google ? Pourquoi les gens iraient là-dessus ? Ils ont fait leur argent que sur le fait que quand tu vas ici, t'as des raccourcis, tu peux mettre des snippets.  Tu as un petit module d'IA, mais c'est tout le monde là maintenant, et c'est où les raccourcis, et là tu vois, tu as des autocompli, tu as des trucs, etc.  Tu as ton calendrier qui est là, et en fait c'est les raccourcis,'est que la fonctionnalité qui fait que les gens payent 40 euros par mois, c'est que la fonctionnalité principale, là moi je fais ça, je fais H, et je dis, lui je veux que tu me renvoies ce mail, tu fais comme si il remonte dans ma boîte mail dans une heure.  In one hour, tac, hop, et donc là je peux l'oublier ce mail, je peux l'oublier, sais que dans une heure il revient.  J'ai appuyé sur H, une heure, je peux faire H, tu vois, 8, 9 a.m. C.E.T. tomorrow, tu vois, j'ai tapé 9 a.m.  C.E.T., hop, il comprend tout de suite, j'ai un rappel demain. Alors, c'est un exemple, mais les gars ont fait une boîte basée là-dessus, sur quelques...  Et après, ils en ont rajouté des centaines, qui fait que tu peux vraiment tout faire juste avec des raccourcis de dingue.  Gagnement, met en productivité. Je lui dis que un petit bouton, un petit raccourci. En fait, pour penser à ça, les gars, je pense qu'ils ont fait des heures et des heures d'itérations, d'écouter le client, de comprendre les trucs, de voir comment ils réagissent.  Parce que c'est difficile de faire mémoriser un raccourci à quelqu'un. Donc, tu vois, le Lightning Edition Module, là, si on devait faire 2-3 Apps Maps, ça n'aurait aucun sens de le développer.  On sait que ça fait partie du cœur de notre métier de mapper le curb, de mapper le stationnement. Limite, tu pourrais dire, si tu ne sais pas mapper le curb, ça ne sert à rien de rajouter du temps réel dessus.  Donc, à partir du moment où on se dit ça, la capacité à éditer une map pour mapper le curb, c'est une fonctionnalité cœur.  Donc, pour moi, je considère que c'est, je ne pas appeler ça stratégique pour la boîte, mais c'est clé, ce module d'Edition Module.  Voilà, tant mieux si ça te... Mais tu vois, dans l'ingénierie, toi, bien sûr, c'est centré IA, c'est ton rôle de pousser l'automatisation.  Mais ce que je te demande, et je pense qu'il est important pour la boîte, tous les niveaux, vois, c'est de prendre cette couleur, cette facette Product Engineering au bon moment, pour dire là, c'est pas qu'un enjeu d'IA, c'est un enjeu système.  Moi, je dois délivrer un truc qui fonctionne. Bien sûr, je dois faire en sorte que la base d'IA, elle soit là, et qu'elle aille de plus en plus vers de'automatisation.  Mais je délivre un produit, vois, et finalement, ce qu'on a fait sur les files d'attente et tout, etc., c'est ça, c'est que'as un cœur qui est 60-65% d'IA.  Si ce truc n'était pas là, ça s'effondrerait. Et puis le reste,'est pas 5%. ça, C'est 35%, 40% du truc qui fait qu'on s'appuie bien sur l'IA, on la valorise.  Là c'est pareil, les 40% qui sont les différents modules, dont le Lightning Edition sur l'Apps Map, sont des briques clés et indispensables.  À la limite le MapThinker peut-être pas, mais l'Edition Module il est indispensable. Quelqu'un qui est très bon en front, qui sait te faire ça mais ne pas utiliser l'IA, il ne pas outir.  Quelqu'un qui est très bon en IA, mais qui ne pense pas à ce genre de choses-là, son IA ne sera pas utilisé.  Soit as besoin d'un Product Manager, d'un UX au-dessus, qui lui va avoir ces idées-là. Là tu démultiplies les besoins d'équipes, bref.  Soit tu as le côté ingénieur un peu polyvalent, bien sûr, tu as des zones de force et des zones de faiblesse, mais tu penses système et tu sais qu'il y a des modules, c'est pas exactement...  Comment ça va être fait, mais dans ta vision du système, tu penses, tu doses bien, tu vois, ce que va faire l'IA et ce qui va compléter l'IA pour qu'elle soit effectivement actionnable et utilisable.  Le reprocessing, c'est bête, mais je pense qu'il a 70% des ingénieurs en IA qui n'y penseraient pas. Ils se diraient, je vais améliorer le modèle, je vais améliorer le modèle, vais améliorer le modèle, et ils rentrent dans une infinite loupe, eux-mêmes.  Et welcome dans Inception, ils n'en sortent pas. 5 ans après, sont encore à dire, putain, j'ai pas encore le pourcentage dans ce cas-là.  Ouais, mais les gars, tu le règles en manuel ou tu le règles en reprocessing avec une input humaine, et voilà.  Tu vois, si je vais un peu plus loin, je suis beaucoup, je suis un fan de Whisperflow maintenant, mais tu te dis, j'appuie sur espace, je fais mon rond et je dicte ce qu'il faut faire.  Ouais, là, il y une poche de stationnement que t'as pas vue avec deux peignes en épi, voilà, sur deux rangées.  de trois et cinq classes, si je le fais à l'oral, je peux me permettre de dire ça, ça me prend deux secondes.  Et ça, tu le mets en texte, boum. Et le truc, il fait le reprocessing avec cet input, extraordinaire. Le truc, il a une qualité de contexte qui est cent fois supérieure à...  Je t'ai mis un petit carré là pour t'aider. Tu vois, question mark, quand tu lances ton processing, tu le lances avec ton processing et ton entraînement.  Imagine, on dit, avant de le lancer, on appuie sur l'espace, tu me fais un speech sur ce que tu vois.  Et ça, je le complète en données d'entrée pour t'aider à te cadrer. Mais tu n pas besoin de dessiner, tu parles.  Je vois un parking avec cinq rangées. Avec, tu vois, rangées ne sont pas forcément bien alignées, etc. Derrière, y a une petite poche en voirie en bas à gauche.  Tu vois, dans chaque region of interest, on donne ces éléments. Et le truc, il prend ça en input, ça lui donne les éléments de contexte, et boum, ça multiplie par deux sa performance.
  ACTION ITEM: Send Google oral-discussion link to Sagaf - WATCH: https://fathom.video/calls/622697948?timestamp=5288.9999  Est-ce que c'est le cas ? Question mark ? Mais franchement, si c'est le cas, c'est super simple à mettre en place.

1:28:14 - Sagaf Youssouf (Cocoparks)
  Parce qu'en plus, chaque cas est différent et tout, vois.

1:28:19 - Raphael Jatteau (Cocoparks)
  Et tu pourrais imaginer, l'autre jour, j'ai eu un truc là sur Google, il faudrait que je te l'envoie, mais il y un devis, et tu sais, as une fonctionnalité Google maintenant qui te dit, enfin, créer une discussion orale sur ton document par lien.  Je crée le devis, je lance le module, au bout de deux minutes, il me sort un truc. Et il a une discussion de dix minutes, de cinq minutes peut-être, où tu as deux personnes qui parlent sur le devis.  Et tu as une femme qui dit, hey John, what do you see there ? Oh, so, c'est ce qui est...  A quote from Cocoparks. Clearly, this is about innovation and smart parking. So let's start with the budget. So on the project side, you know, this requires some heavy work, you know, so that's why we get a cost of about 10,000 euros, which is not nothing.  Ils ont commenté toutes les lignes comme ça. J été, j'ai halluciné,'ai fait, c'est énorme. en même temps, vois, derrière, disait, but at the same time, there is a lot of work to do, and those guys, they know what they do, they work well.  tu vois, discutaient des prix et même de critiquer les prix qu'on avait mis, vois.

1:29:38 - Sagaf Youssouf (Cocoparks)
  Je connais, je connais, tu peux faire des podcasts avec ça, oui.

1:29:42 - Raphael Jatteau (Cocoparks)
  Donc, est-ce que, vois, te pose une question. Si, on donne la Region of Interest, on donne à l'utilisateur quelques indices, avant même de lancer le modèle qui peut prendre un peu de temps, sur globalement la compréhension qu'a le système.  de ce qu'il voit. exemple, le truc, as un texte à côté, tu scrolles, et puis tu as un texte à côté qui dit deux poches de parking, un en épi, un en linéaire, quelques voitures en bas à droite, et tu vois, on fait réagir le gars à ce truc-là, tu as cette compréhension-là de l'espace, non, il n pas de poche en bas à droite, le parking, effectivement, il est là, il est un peu plus grand que ce que tu penses, parce qu'il y une contre-allée, non, c'est rien, tu vois, et là, on crée de, je ne sais pas si c'est possible, mais tu vois, c'est de s'appuyer sur la capacité aujourd'hui à donner du contexte, je ne pas si ça peut être utile pour les approches qu a, parce qu'on n'est pas sur des modèles LLM, mais ouais.

1:30:40 - Sagaf Youssouf (Cocoparks)
  Ouais, ouais. Après,-ce que, par rapport à l'objectif qu'on veut faire,-ce que ça...

1:30:52 - Raphael Jatteau (Cocoparks)
  Peut-être pas, peut-être pas, ouais, peut-être pas, mais ça aurait été une autre approche, vois, mais... Non, peut-être pas, peut-être pas.  Mais tu vois,'est le côté, parce que mon point, c'était surtout de dire, tu as l'ingénieur, que je vais plutôt appeler AI développeur, qui est en mode, l'IA, faut que je l'améliore, je l'améliore, je l'améliore, je l'itère, et puis en fait, du coup, tu es sur un cycle en V, quand tu fais ça, c'est pas un type.  Et l'ingénieur qui dit, ok, j'ai l'IA, l'IA, elle devra forcément être complétée, et après, je vais itérer pour faire le truc, mais même si je travaille pendant, je travaille pendant, pendant deux mois dessus, je ne serai jamais au 5%.  Il y trop de variabilité dans les cas. Ok, allez, merci Sagaf, je pense que là, on a...

1:31:48 - Sagaf Youssouf (Cocoparks)
  Le document, ouais. Je vais tout supprimer.

1:31:52 - Raphael Jatteau (Cocoparks)
  Il y a les favelles, j'ai regardé. Non, plaisante. Attends, share. Tu l'as déjà, je pense que'est dans ma quête, Sagaf.  C'est bon, tu l déjà, je te l'envoie.'est bon, c pas top.

1:32:05 - Sagaf Youssouf (Cocoparks)
  Je te l'envoie. Bon là, on a fait un gros boulot là. C'est le plus dur en plus.

1:32:12 - Raphael Jatteau (Cocoparks)
  Allez, let's go. Tu dirais qu'à Cursor, il te fait le reste. C'est ça, le jour où Cursor est capable de faire ce genre de raisonnement là.  D'ailleurs, là je suis une IA, c'est une IA de Raphaël, je suis un clone. C'est simple. Exactement. Allez, à toi de jouer.  Bon courage. Salut. On repose, toi bien. Salut.